// weather.js — rain streaks, snow, dust, ash and embers, all GPU particles that are a pure function of t (no state:
// any frame or sub-frame renders on its own). Each layer is a box of particles anchored in the world and wrapped
// around the camera (so they parallax correctly while the box follows the lens), faded near the lens and at the box
// edge (the wrap is never seen) and with distance. Wind drifts everything; `weather.wind` 0..1 = 0..12 m/s.
import * as THREE from 'three';
import { rng, clamp } from '../lib/shared/util.js';
import { U } from '../lib/shared/env.js';

const LOGV = /* glsl */`#include <common>\n#include <logdepthbuf_pars_vertex>`;
const LOGF = /* glsl */`#include <common>\n#include <logdepthbuf_pars_fragment>`;

// shared motion model: p(t) for particle seed a in a box, by kind
const MOTION = /* glsl */`
  uniform float uT, uBox, uFall, uWob, uRise, uAmt, uNear; uniform vec3 uCam, uWind;
  vec3 wrapBox(vec3 p){ vec3 rel = mod(p - uCam + 0.5 * uBox, uBox) - 0.5 * uBox; return rel; }
  vec3 motion(vec4 a, float t){
    float sp = mix(0.7, 1.35, a.w);
    vec3 p = a.xyz * uBox + uWind * t * mix(0.85, 1.15, a.y) - vec3(0.0, uFall * sp * t, 0.0) + vec3(0.0, uRise * sp * t, 0.0);
    p += vec3(sin(t * 1.3 * sp + a.x * 40.0), 0.35 * sin(t * 0.9 * sp + a.w * 17.0), cos(t * 1.1 * sp + a.z * 40.0)) * uWob;
    return p;
  }
  float boxFade(vec3 rel, float d){
    return smoothstep(uNear, uNear * 3.0 + 0.2, d) * (1.0 - smoothstep(uBox * 0.36, uBox * 0.5, max(abs(rel.x), max(abs(rel.y), abs(rel.z)))));
  }
`;

function seeds(n, seed) {
  const r = rng(seed), a = new Float32Array(n * 4);
  for (let i = 0; i < n * 4; i++) a[i] = r();
  return a;
}

// points: snow, ash, dust, embers
function pointLayer(n, box, o) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seeds(n, o.seed), 4));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
  const SU = {
    uT: { value: 0 }, uBox: { value: box }, uFall: { value: o.fall }, uWob: { value: o.wob }, uRise: { value: o.rise ?? 0 },
    uAmt: { value: 0 }, uNear: { value: o.near ?? 0.4 }, uCam: { value: new THREE.Vector3() }, uWind: { value: new THREE.Vector3() },
    uSize: { value: o.size }, uScale: { value: 1000 }, uCol: { value: new THREE.Color(...o.col) }, uAlpha: { value: o.alpha ?? 0.9 },
    uFlicker: { value: o.flicker ?? 0 }, uLife: { value: o.life ?? 0 }, uFogK: { value: o.fogK ?? 0.01 }, uMaxPx: { value: o.maxPx ?? 40 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: SU, transparent: true, depthWrite: false,
    blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    vertexShader: /* glsl */`${LOGV}
      attribute vec4 aSeed; uniform float uSize, uScale, uAlpha, uFlicker, uLife, uFogK, uMaxPx; varying float vA; varying float vGlow;
      ${MOTION}
      void main(){
        vec3 p = motion(aSeed, uT);
        float life = 1.0;
        if (uLife > 0.0) {                              // embers: each spark lives, glows and dies, then re-spawns unseen
          float ph = fract(uT / uLife * mix(0.8, 1.25, aSeed.y) + aSeed.z * 7.13);
          life = smoothstep(0.0, 0.15, ph) * (1.0 - smoothstep(0.55, 1.0, ph));
          p.y += ph * uLife * 0.8;
        }
        vec3 rel = wrapBox(p);
        vec4 mv = modelViewMatrix * vec4(uCam + rel, 1.0);
        gl_Position = projectionMatrix * mv;
        float d = -mv.z;
        float on = step(fract(aSeed.y * 13.37 + aSeed.w * 7.13) * 0.999, uAmt);                  // intensity = share of the particles that exist
        float fl = 1.0 - uFlicker + uFlicker * (0.5 + 0.5 * sin(uT * (6.0 + aSeed.w * 9.0) + aSeed.y * 30.0));
        vA = uAlpha * on * boxFade(rel, d) * life * fl * exp(-d * uFogK);
        vGlow = life;
        gl_PointSize = clamp(uSize * mix(0.6, 1.4, aSeed.y) * uScale / max(d, 0.05), 1.0, uMaxPx);
        if (vA < 0.002) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */`${LOGF}
      uniform vec3 uCol; varying float vA; varying float vGlow;
      void main(){
        #include <logdepthbuf_fragment>
        vec2 q = gl_PointCoord * 2.0 - 1.0; float r2 = dot(q, q);
        if (r2 > 1.0) discard;
        float a = vA * (1.0 - r2) * (1.0 - r2);
        gl_FragColor = vec4(uCol, a);
      }`,
  });
  const pts = new THREE.Points(g, mat); pts.frustumCulled = false; pts.renderOrder = 10; pts.visible = false;
  pts.userData.noQA = true;
  return { obj: pts, SU };
}

// ash: soft grey-white flakes that tumble as they fall (camera-facing quads, squashed edge-on and turned by the tumble,
// brighter when turned to the light, a slightly darker rim so they read against a bright sky), drifting with the wind.
// A flake never draws thinner than uMinPx pixels; when it would, it fades by its true area (no grey rain or haze).
function flakeLayer(n, box, o) {
  const quad = new THREE.PlaneGeometry(1, 1);
  const g = new THREE.InstancedBufferGeometry();
  g.index = quad.index; g.setAttribute('position', quad.attributes.position);
  g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds(n, o.seed), 4));
  g.instanceCount = n;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
  const SU = {
    uT: { value: 0 }, uBox: { value: box }, uFall: { value: o.fall }, uWob: { value: o.wob }, uRise: { value: 0 },
    uAmt: { value: 0 }, uNear: { value: o.near ?? 0.5 }, uCam: { value: new THREE.Vector3() }, uWind: { value: new THREE.Vector3() },
    uSize: { value: o.size }, uPx: { value: 0.001 }, uMinPx: { value: o.minPx ?? 1.6 }, uCol: { value: new THREE.Color(0.6, 0.6, 0.6) },
    uAlpha: { value: o.alpha ?? 0.95 }, uFogK: { value: o.fogK ?? 0.02 }, uTumble: { value: o.tumble === false ? 0 : 1 },
    uFwd: { value: new THREE.Vector3(0, 0, -1) },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: SU, transparent: true, depthWrite: false,
    vertexShader: /* glsl */`${LOGV}
      attribute vec4 aSeed; uniform float uSize, uPx, uMinPx, uAlpha, uFogK, uTumble; uniform vec3 uFwd;
      varying float vA; varying vec2 vQ; varying float vShade; varying float vSeed;
      ${MOTION}
      void main(){
        vec3 rel = wrapBox(motion(aSeed, uT));
        vec3 c = uCam + rel;
        // depth of field: the sub-frame camera sits on the aperture (cameraPosition - uCam) aimed at the focus; one flake
        // would draw as a ring of copies, so undo its parallax and grow it into a soft blob by the circle of confusion
        float coc = 0.0;
        vec3 ap = cameraPosition - uCam;
        if (dot(ap, ap) > 1e-10) {
          vec3 fj = -vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
          float cs = dot(fj, uFwd), sn = length(fj - uFwd * cs);
          if (sn > 1e-7) { float fd = length(ap) * cs / sn, k = 1.0 - dot(rel, uFwd) / fd; c += ap * k; coc = length(ap) * abs(k) * 1.6; }
        }
        vec3 toCam = cameraPosition - c; float d = length(toCam); toCam /= max(d, 1e-4);
        vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam)); vec3 up = cross(toCam, right);
        float w = mix(1.6, 4.2, fract(aSeed.x * 7.13)) * (fract(aSeed.z * 3.71) > 0.5 ? 1.0 : -1.0);
        float face = mix(1.0, abs(cos(uT * w + aSeed.y * 6.2832)), uTumble);  // tumbling: face-on .. edge-on
        float rot = uT * w * 0.31 * uTumble + aSeed.w * 6.2832;
        float s = uSize * mix(0.55, 1.7, aSeed.y * aSeed.y);
        float sz = max(s, d * uPx * uMinPx) + coc;
        vec2 q = position.xy; q.y *= 0.28 + 0.72 * face;
        q = mat2(cos(rot), sin(rot), -sin(rot), cos(rot)) * q;
        vec4 mv = viewMatrix * vec4(c + (right * q.x + up * q.y) * sz, 1.0);
        gl_Position = projectionMatrix * mv;
        float on = step(fract(aSeed.y * 13.37 + aSeed.w * 7.13) * 0.999, uAmt);
        vA = uAlpha * on * boxFade(rel, d) * exp(-d * uFogK) * min(1.0, (s / sz) * (s / sz) * 2.2) * (0.7 + 0.3 * face);
        vQ = position.xy * 2.0; vSeed = aSeed.z; vShade = mix(0.5, 1.3, face * face) * mix(0.85, 1.12, fract(aSeed.w * 5.3));
        if (vA < 0.003) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */`${LOGF}
      uniform vec3 uCol; varying float vA; varying vec2 vQ; varying float vShade; varying float vSeed;
      void main(){
        #include <logdepthbuf_fragment>
        float an = atan(vQ.y, vQ.x);
        float r = length(vQ) * (1.0 + 0.16 * sin(an * 3.0 + vSeed * 40.0) + 0.09 * sin(an * 5.0 + vSeed * 17.0));
        float a = vA * (1.0 - smoothstep(0.45, 1.0, r));
        if (a < 0.004) discard;
        gl_FragColor = vec4(uCol * vShade * (1.0 - 0.32 * smoothstep(0.2, 0.95, r)), a);
      }`,
  });
  const mesh = new THREE.Mesh(g, mat); mesh.frustumCulled = false; mesh.renderOrder = 10; mesh.visible = false;
  mesh.userData.noQA = true;
  return { obj: mesh, SU, flake: o.snap !== false };
}

// volcanic ash (weather.ash_kind "volcanic"): small angular grey-brown specks of rock and glass falling fast, each a short
// streak along its velocity (seen through a short shutter), never white, never a round flake. The quad runs from the
// grain's position back along its motion by uLen seconds; a jagged shard mask; below uMinPx it fades by its area.
function gritLayer(n, box, o) {
  const quad = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
  const g = new THREE.InstancedBufferGeometry();
  g.index = quad.index; g.setAttribute('position', quad.attributes.position);
  g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds(n, o.seed), 4));
  g.instanceCount = n;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
  const SU = {
    uT: { value: 0 }, uBox: { value: box }, uFall: { value: o.fall }, uWob: { value: o.wob ?? 0.15 }, uRise: { value: 0 },
    uAmt: { value: 0 }, uNear: { value: o.near ?? 0.5 }, uCam: { value: new THREE.Vector3() }, uWind: { value: new THREE.Vector3() },
    uCol: { value: new THREE.Color(0.4, 0.38, 0.34) }, uLen: { value: o.len ?? 0.012 }, uPx: { value: 0.001 }, uSize: { value: o.size },
    uMinPx: { value: o.minPx ?? 1.6 }, uAlpha: { value: o.alpha ?? 0.85 }, uFogK: { value: o.fogK ?? 0.02 }, uFwd: { value: new THREE.Vector3(0, 0, -1) },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: SU, transparent: true, depthWrite: false,
    vertexShader: /* glsl */`${LOGV}
      attribute vec4 aSeed; uniform float uLen, uPx, uSize, uMinPx, uAlpha, uFogK; uniform vec3 uFwd; varying float vA; varying vec2 vQ; varying float vSeed; varying float vShade;
      ${MOTION}
      void main(){
        vec3 rel = wrapBox(motion(aSeed, uT));
        vec3 vel = uWind * mix(0.85, 1.15, aSeed.y) - vec3(0.0, uFall * mix(0.7, 1.35, aSeed.w), 0.0);
        vec3 head = uCam + rel;
        float coc = 0.0; vec3 ap = cameraPosition - uCam;                  // depth of field: one soft grain, not copies
        if (dot(ap, ap) > 1e-10) {
          vec3 fj = -vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
          float cs = dot(fj, uFwd), sn = length(fj - uFwd * cs);
          if (sn > 1e-7) { float fd = length(ap) * cs / sn, k = 1.0 - dot(rel, uFwd) / fd; head += ap * k; coc = length(ap) * abs(k) * 1.6; }
        }
        float d0 = length(cameraPosition - head);
        float s = uSize * mix(0.5, 1.6, aSeed.x * aSeed.x);
        float w0 = max(s, d0 * uPx * uMinPx);
        float w = w0 + min(coc, w0 * 1.5);                                // grit stays crisp: a little soft, never a faint blur disc
        vec3 tail = head - vel * uLen - normalize(vel) * w;               // at least as long as it is wide
        vec3 wp = mix(tail, head, position.y);
        vec3 axis = normalize(head - tail), toCam = normalize(cameraPosition - wp);
        vec3 side = normalize(cross(axis, toCam));
        wp += side * position.x * w;
        vec4 mv = viewMatrix * vec4(wp, 1.0);
        gl_Position = projectionMatrix * mv;
        float on = step(fract(aSeed.y * 13.37 + aSeed.w * 7.13) * 0.999, uAmt);
        vA = uAlpha * on * boxFade(rel, d0) * exp(-d0 * uFogK) * min(1.0, (s / w) * 2.0);
        vQ = vec2(position.x * 2.0, position.y * 2.0 - 1.0); vSeed = aSeed.z; vShade = mix(0.55, 1.35, fract(aSeed.w * 5.3 + aSeed.x));   // dark glass to pale pumice
        if (vA < 0.003) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */`${LOGF}
      uniform vec3 uCol; varying float vA; varying vec2 vQ; varying float vSeed; varying float vShade;
      void main(){
        #include <logdepthbuf_fragment>
        float an = vSeed * 6.2832, c = cos(an), s = sin(an);
        vec2 r = mat2(c, s, -s, c) * vQ;
        float shard = max(abs(r.x) * (1.0 + 0.5 * vSeed) + abs(r.y) * 0.45, abs(r.y) * (1.1 + 0.4 * fract(vSeed * 7.0)));   // a jagged grain
        float a = vA * (1.0 - smoothstep(0.62, 1.0, shard)) * (0.55 + 0.45 * (1.0 - abs(vQ.y)));
        if (a < 0.004) discard;
        gl_FragColor = vec4(uCol * vShade, a);
      }`,
  });
  const mesh = new THREE.Mesh(g, mat); mesh.frustumCulled = false; mesh.renderOrder = 10; mesh.visible = false;
  mesh.userData.noQA = true;
  return { obj: mesh, SU, flake: true };
}

// rain: thin quads stretched along each drop's velocity (a drop seen through a 1/60 s shutter)
function rainLayer(n, box, o) {
  const quad = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
  const g = new THREE.InstancedBufferGeometry();
  g.index = quad.index; g.setAttribute('position', quad.attributes.position);
  g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds(n, o.seed), 4));
  g.instanceCount = n;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
  const SU = {
    uT: { value: 0 }, uBox: { value: box }, uFall: { value: 9.0 }, uWob: { value: 0 }, uRise: { value: 0 },
    uAmt: { value: 0 }, uNear: { value: 0.6 }, uCam: { value: new THREE.Vector3() }, uWind: { value: new THREE.Vector3() },
    uCol: { value: new THREE.Color(0.7, 0.74, 0.8) }, uLen: { value: 0.045 }, uPx: { value: 0.001 }, uAlpha: { value: o.alpha ?? 0.22 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: SU, transparent: true, depthWrite: false,
    vertexShader: /* glsl */`${LOGV}
      attribute vec4 aSeed; uniform float uLen, uPx, uAlpha; varying float vA; varying float vX;
      ${MOTION}
      void main(){
        vec3 p1 = motion(aSeed, uT);
        vec3 vel = uWind - vec3(0.0, uFall * mix(0.7, 1.35, aSeed.w), 0.0);
        vec3 rel = wrapBox(p1);
        vec3 head = uCam + rel, tail = head - vel * uLen;
        vec3 wp = mix(tail, head, position.y);
        vec3 axis = normalize(head - tail);
        vec3 toCam = normalize(cameraPosition - wp);
        vec3 side = normalize(cross(axis, toCam));
        float d = length(cameraPosition - wp);
        float w = max(0.004, d * uPx * 1.7);
        wp += side * position.x * w;
        vec4 mv = viewMatrix * vec4(wp, 1.0);
        gl_Position = projectionMatrix * mv;
        float on = step(fract(aSeed.y * 13.37 + aSeed.w * 7.13) * 0.999, uAmt);
        vA = uAlpha * on * boxFade(rel, d) * (0.4 + 0.6 * aSeed.z) * clamp(0.004 / w * 2.5, 0.25, 1.0);
        vX = position.x * 2.0;
        if (vA < 0.002) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */`${LOGF}
      uniform vec3 uCol; varying float vA; varying float vX;
      void main(){
        #include <logdepthbuf_fragment>
        float a = vA * (1.0 - vX * vX);
        gl_FragColor = vec4(uCol, a);
      }`,
  });
  const mesh = new THREE.Mesh(g, mat); mesh.frustumCulled = false; mesh.renderOrder = 10; mesh.visible = false;
  mesh.userData.noQA = true;
  return { obj: mesh, SU, rain: true };
}

export function makeWeather(scene) {
  const group = new THREE.Group(); group.name = 'weather'; group.userData.noQA = true; scene.add(group);
  const L = {
    rainNear: rainLayer(12000, 22, { seed: 11, alpha: 0.42 }),
    rainFar: rainLayer(26000, 80, { seed: 12, alpha: 0.24 }),
    snowNear: pointLayer(14000, 26, { seed: 3, fall: 0.9, wob: 0.18, size: 0.018, col: [0.93, 0.95, 0.98], near: 0.35, alpha: 1.0 }),
    snowFar: pointLayer(30000, 110, { seed: 7, fall: 0.9, wob: 0.18, size: 0.03, col: [0.93, 0.95, 0.98], fogK: 0.004, alpha: 0.9 }),
    ashNear: flakeLayer(15000, 22, { seed: 17, fall: 0.6, wob: 0.3, size: 0.048, minPx: 2.4, fogK: 0.03, alpha: 0.95 }),
    ashFar: flakeLayer(26000, 72, { seed: 18, fall: 0.6, wob: 0.35, size: 0.05, minPx: 1.6, fogK: 0.02, alpha: 0.85, near: 6 }),
    dust: pointLayer(14000, 40, { seed: 21, fall: 0.02, wob: 0.25, size: 0.006, col: [0.78, 0.66, 0.5], alpha: 0.5, maxPx: 12 }),
    dustNear: flakeLayer(9000, 18, { seed: 22, fall: 0.05, wob: 0.6, size: 0.014, minPx: 1.6, fogK: 0.05, alpha: 0.75, near: 0.6, tumble: false, snap: false }),
    gritNear: gritLayer(16000, 16, { seed: 41, fall: 3.2, wob: 0.12, size: 0.005, minPx: 2.0, len: 0.006, fogK: 0.03, alpha: 1.0, near: 0.4 }),
    gritFar: gritLayer(34000, 60, { seed: 42, fall: 3.2, wob: 0.2, size: 0.004, minPx: 1.3, len: 0.006, fogK: 0.016, alpha: 0.7, near: 3 }),
    embers: pointLayer(2600, 44, { seed: 31, fall: -0.9, wob: 0.5, size: 0.02, col: [6.0, 2.2, 0.55], additive: true, flicker: 0.6, life: 3.2, alpha: 1.0, maxPx: 10 }),
  };
  for (const l of Object.values(L)) group.add(l.obj);
  let W = { rain: 0, snow: 0, dust: 0, ash: 0, embers: 0 }, wind = new THREE.Vector3(), light = [1, 1, 1];
  const sstep = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };

  // per scene: intensities, wind (m/s vector), and the light the particles are lit by
  function set(w = {}, env, seed = 1) {
    W = { rain: clamp(w.rain ?? 0), snow: clamp(w.snow ?? 0), dust: clamp(w.dust ?? 0), ash: clamp(w.ash ?? 0), embers: clamp(w.embers ?? 0) };
    // ash on the ground: grey on every up-facing surface (env.js). weather.ash_cover 0..1; by default only heavy ash
    // (a supervolcano's fall) lays a cover, the light ash of a wildfire or a distant eruption does not
    // weather.ash_kind "volcanic": falling grit (not flakes), a grey-brown ash haze and sky light, a matte grey deposit
    // on roofs, cars and roads too (env.js); the default kind (wildfire ash flakes) is unchanged
    const volc = String(w.ash_kind || '').toLowerCase() === 'volcanic' && W.ash > 0;
    if (U.uAshKind) U.uAshKind.value = volc ? 1 : 0;
    U.uAsh.value = clamp(w.ash_cover ?? (volc ? 0.95 * sstep((W.ash - 0.25) / 0.55) : 0.8 * sstep((W.ash - 0.6) / 0.4)));
    const spd = clamp(w.wind ?? 0.15) * 12;
    const dir = (w.windDir ?? ((seed * 137) % 360)) * Math.PI / 180;
    wind.set(Math.sin(dir) * spd, 0, -Math.cos(dir) * spd);
    const e = env;
    light = e ? e.amb.map((v, i) => Math.min(1.3, v * e.ambI * 1.1 + e.sunColor[i] * e.sunI * 0.22 + e.moonColor[i] * e.moonI * 0.2)) : [0.8, 0.82, 0.86];
    const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    const li = Math.max(0.05, lum(light));
    // flakes scatter light forward and read brighter than the ground behind them
    L.snowNear.SU.uCol.value.setRGB(...light.map((v) => v * 1.9 + 0.04));
    L.snowFar.SU.uCol.value.setRGB(...light.map((v) => v * 1.6 + 0.03));
    L.rainNear.SU.uCol.value.setRGB(...light.map((v) => v * 1.08 + 0.02));
    L.rainFar.SU.uCol.value.setRGB(...light.map((v) => v * 0.95));
    L.ashNear.SU.uCol.value.setRGB(...light.map((v, i) => v * [0.8, 0.78, 0.75][i] + 0.02));
    L.ashFar.SU.uCol.value.setRGB(...light.map((v, i) => v * [0.74, 0.73, 0.7][i] + 0.02));
    L.dust.SU.uCol.value.setRGB(...[0.78, 0.66, 0.5].map((v, i) => v * light[i] * 1.2));
    L.dustNear.SU.uCol.value.setRGB(...[0.74, 0.62, 0.47].map((v, i) => v * light[i] * 1.15));
    L.gritNear.SU.uCol.value.setRGB(li * 0.66, li * 0.61, li * 0.53);               // grey-brown grit, lit but never white
    L.gritFar.SU.uCol.value.setRGB(li * 0.6, li * 0.56, li * 0.49);
    if (volc) {
      const k = W.ash, fc = U.uFogColor.value, gl = 0.2126 * fc.r + 0.7152 * fc.g + 0.0722 * fc.b;
      U.uFogDensity.value *= 1 + 1.6 * k;                                          // a denser grey ash haze
      fc.lerp(new THREE.Color(gl * 1.03, gl * 0.97, gl * 0.86), 0.8 * k);          // grey-brown, no blue
      U.uFogSunColor.value.multiplyScalar(1 - 0.6 * k);
      if (U.uFogBlue) U.uFogBlue.value *= 1 - k;
      if (U.uFogNear) U.uFogNear.value.lerp(fc, k);
      scene.traverse((o) => {                                                       // sky light through an ash cloud
        if (!o.isHemisphereLight || o.userData?.fx) return;
        const c = o.color, l = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
        c.lerp(new THREE.Color(l * 1.04, l * 0.98, l * 0.86), 0.75 * k);
      });
    }
    const amt = { rainNear: W.rain, rainFar: W.rain, snowNear: W.snow, snowFar: W.snow, ashNear: volc ? 0 : W.ash, ashFar: volc ? 0 : W.ash, dust: W.dust, dustNear: W.dust, embers: W.embers, gritNear: volc ? W.ash : 0, gritFar: volc ? W.ash : 0 };
    for (const [k, l] of Object.entries(L)) {
      l.SU.uAmt.value = amt[k];
      l.SU.uWind.value.copy(wind).multiplyScalar(k.startsWith('dust') ? 1.3 : k === 'embers' ? 0.8 : k.startsWith('rain') ? 0.6 : k.startsWith('ash') ? 0.35 : k.startsWith('grit') ? 0.55 : 1);
      l.obj.visible = amt[k] > 0.001;
    }
    return { wind: [wind.x, wind.z], speed: spd };
  }

  function update(t, camera, H) {
    const pxRad = 2 * Math.tan((camera.fov * Math.PI / 180) / 2) / H;       // metres per pixel at 1 m
    for (const l of Object.values(L)) {
      if (!l.obj.visible) continue;
      l.SU.uT.value = l.flake ? Math.round(t * 30) / 30 : t;      // ash flakes: crisp, tumbling shapes, not shutter streaks
      l.SU.uCam.value.copy(camera.position);
      if (l.SU.uFwd) camera.getWorldDirection(l.SU.uFwd.value);
      if (l.SU.uScale) l.SU.uScale.value = 1 / pxRad;
      if (l.SU.uPx) l.SU.uPx.value = pxRad;
    }
  }
  return { group, set, update, get wind() { return wind; } };
}
