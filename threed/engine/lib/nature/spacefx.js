// spacefx.js — E4 (v2, 27 Sep 2026): the "being there" pieces other worlds share: a sky dome for airless / alien skies
// (stars even by day, the Sun at its true size for that world with glare, Pluto's layered blue horizon haze, Venus's
// orange murk with a hidden sun, Titan's haze, the Martian butterscotch sky with its blue sunset), the per-frame light
// override (the look's key light, hemisphere, exposure, fog and image-based light are Earth's; a world here replaces
// them after the look has set them, every sub-frame), an environment map baked from the world's own sky (no blue
// Earth sky in a visor or on the regolith), dust motes in thin air and drifting haze veils in thick air.
// Every value is a function of t (and the scene's fixed setup): frames stay pure.
import * as THREE from 'three';
import { U } from '../shared/env.js';
import { rng } from '../shared/util.js';
import { NOISE_GLSL } from './tex.js';

// the page's look (key light, hemisphere, the resolved look `cur` with keyDir and env.exposure); null while planning
export function lookHandle() { try { const f = globalThis.__f3d; return (f && typeof f.look === 'function' && f.look()) || null; } catch (e) { return null; } }

// o: {dir: Vector3 (toward the sun), key: [r,g,b], keyI, shadow, soft, hemi: [r,g,b], gnd, hemiI, exposure, sunColor,
//     fog: [r,g,b], fogSun, fogDensity, fogFalloff, env: Texture, envI}
export function overrideLights(ctx, o) {
  const lk = lookHandle(); const L = lk && lk.cur;
  if (lk) {
    if (o.dir && L && L.keyDir) L.keyDir.copy(o.dir);
    if (o.exposure != null && L && L.env) L.env.exposure = o.exposure;
    if (o.key) {
      lk.key.color.setRGB(o.key[0], o.key[1], o.key[2]); lk.key.intensity = o.keyI ?? 1.05;
      const cs = o.shadow !== false && (o.keyI ?? 1) > 0.02; if (lk.key.castShadow !== cs) lk.key.castShadow = cs;
      if (o.soft != null) lk.key.shadow.radius = o.soft;
    }
    if (o.hemi) { lk.hemi.color.setRGB(...o.hemi); lk.hemi.groundColor.setRGB(...(o.gnd || [0, 0, 0])); lk.hemi.intensity = o.hemiI ?? 1; }
  }
  if (o.sunColor) U.uSunColor.value.setRGB(...o.sunColor);
  if (o.fog) {
    U.uFogColor.value.setRGB(...o.fog); U.uFogSunColor.value.setRGB(...(o.fogSun || [0, 0, 0]));
    U.uFogDensity.value = o.fogDensity ?? 0; if (o.fogFalloff != null) U.uFogFalloff.value = o.fogFalloff; U.uFogBlue.value = 0;
  }
  const sc = ctx && ctx.world3;
  if (sc && o.env !== undefined) { sc.environment = o.env; sc.environmentIntensity = o.envI ?? 1; }
}

// an environment map from a sky material (the dome shader), baked once per scene (after the look has set the sun)
let PMREM = null, LAST_ENV = null;
export function bakeEnv(ctx, material) {
  if (!ctx || !ctx.renderer) return null;
  PMREM ||= new THREE.PMREMGenerator(ctx.renderer);
  const sc = new THREE.Scene();
  const m = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), material); m.frustumCulled = false; sc.add(m);
  const rt = PMREM.fromScene(sc, 0.02, 0.1, 1000);
  m.geometry.dispose();
  if (LAST_ENV && LAST_ENV !== rt) { try { LAST_ENV.dispose(); } catch (e) { /* */ } }
  LAST_ENV = rt;
  return rt.texture;
}

// ── the sky dome ────────────────────────────────────────────────────────────────────────────────────────────────────
// o: zen, hor, horSun (rgb, linear), day (0..1 gradient level), sunR (angular radius, deg), sunI (disc brightness),
//    glare (0..), glareW (1 = a tight glare, 0.1 = a broad diffuse glow), stars (0..), haze (Pluto's layered blue
//    band strength), hazeCol, murk (Venus/Titan: moving mottling overhead), aure (Mars: the blue aureole), mode
export function skyDome(o = {}) {
  const u = {
    uSun: o.uSun || { value: new THREE.Vector3(0.5, 0.5, 0.5).normalize() }, uTime: { value: 0 },
    uZen: { value: new THREE.Color(...(o.zen || [0, 0, 0])) }, uHor: { value: new THREE.Color(...(o.hor || [0, 0, 0])) }, uHorSun: { value: new THREE.Color(...(o.horSun || o.hor || [0, 0, 0])) },
    uDay: { value: o.day ?? 1 }, uSunR: { value: (o.sunR ?? 0.27) * Math.PI / 180 }, uSunI: { value: o.sunI ?? 40 }, uGlare: { value: o.glare ?? 1 }, uGlareW: { value: o.glareW ?? 1 },
    uStars: { value: o.stars ?? 0 }, uHaze: { value: o.haze ?? 0 }, uHazeCol: { value: new THREE.Color(...(o.hazeCol || [0.3, 0.5, 1])) },
    uMurk: { value: o.murk ?? 0 }, uAure: { value: o.aure ?? 0 }, uMars: { value: o.mars ? 1 : 0 }, uDisc: { value: new THREE.Color(...(o.disc || [1, 0.97, 0.92])) },
    uBody: { value: new THREE.Vector3(0, 1, 0) }, uBodyR: { value: 0 }, uBodyCol: { value: new THREE.Color(0.5, 0.5, 0.5) },
    uFlash: { value: 0 }, uFlashDir: { value: new THREE.Vector3(0, 1, 0) }, uShimmer: { value: o.shimmer ?? 0 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: u,
    vertexShader: `varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0); gl_Position = p.xyww; }`,
    fragmentShader: /* glsl */`
      varying vec3 vDir;
      uniform vec3 uSun, uZen, uHor, uHorSun, uHazeCol, uDisc, uBody, uBodyCol, uFlashDir; uniform float uTime, uDay, uSunR, uSunI, uGlare, uGlareW, uStars, uHaze, uMurk, uAure, uMars, uBodyR, uFlash, uShimmer;
      ${NOISE_GLSL}
      vec3 stars(vec3 rd, float scale, float th, float gain){
        vec3 p = rd * scale; vec3 ci = floor(p), cf = fract(p);
        float h = n_h13(ci);
        if (h < th) return vec3(0.0);
        vec3 sp = vec3(n_h13(ci + 1.7), n_h13(ci + 3.3), n_h13(ci + 5.1)) * 0.6 + 0.2;
        float d = length(cf - sp);
        float mag = pow((h - th) / (1.0 - th), 5.0);
        vec3 sc = mix(vec3(1.0, 0.8, 0.6), vec3(0.72, 0.82, 1.0), n_h13(ci + 9.0));
        return sc * smoothstep(0.09, 0.0, d) * (0.35 + 3.2 * mag) * gain;
      }
      void main(){
        vec3 rd = normalize(vDir), L = normalize(uSun);
        float y = rd.y, mu = dot(rd, L), ang = acos(clamp(mu, -1.0, 1.0));
        float yy = max(y, 0.0);
        vec2 sxz = normalize(L.xz + 1e-5), rxz = normalize(rd.xz + 1e-5);
        float toward = max(dot(sxz, rxz), 0.0);
        vec3 hor = mix(uHor, uHorSun, pow(toward, 3.0));
        vec3 col = mix(hor, uZen, pow(yy, 0.45)) * uDay;
        if (uMurk > 0.0) {                                   // a thick deck overhead: slow, huge mottling
          vec2 q = rd.xz / (yy + 0.25) * 1.3;
          float n = n_fbm2(q + vec2(uTime * 0.004, uTime * 0.0015), 5);
          col *= 1.0 + (n - 0.5) * 0.55 * uMurk * smoothstep(0.0, 0.3, yy);
          col *= 1.0 + (n_fbm2(vec2(atan(rd.x, rd.z) * 3.0, yy * 20.0 - uTime * 0.05), 4) - 0.5) * 0.12 * uMurk * (1.0 - smoothstep(0.0, 0.12, yy));
        }
        if (uMars > 0.5) {                                   // Mars: a blue aureole round the sun (dust scattering), strongest at sunset
          float low = 1.0 - smoothstep(0.02, 0.35, L.y);
          float au = pow(max(mu, 0.0), 10.0);
          col = mix(col, vec3(0.3, 0.46, 0.72) * (0.35 + 1.1 * au) * max(uDay, 0.25), au * mix(0.3, 0.92, low) * smoothstep(-0.15, 0.0, L.y));
          col *= mix(1.0, 0.5, low * (1.0 - au) * smoothstep(0.0, 0.5, yy + 0.2));
        }
        // stars (on an airless world even by day), fading into any haze at the horizon
        if (uStars > 0.0) {
          vec3 s = stars(rd, 300.0, 0.9, 1.0) + stars(rd, 700.0, 0.95, 0.45) + stars(rd, 1500.0, 0.975, 0.22);
          vec3 gn = normalize(vec3(0.35, 0.55, -0.76));
          float bq = dot(rd, gn) / 0.2; float band = exp(-bq * bq);
          s += vec3(0.5, 0.56, 0.72) * band * n_fbm3(rd * 5.0, 4) * 0.05;
          col += s * uStars * smoothstep(-0.01, 0.06, y) * (1.0 - smoothstep(0.0, 0.12, ang) * 0.9);
        }
        // a body hanging in the sky (Charon over Pluto, Earth over the Moon ...): a lit disc
        if (uBodyR > 0.0) {
          float bd = acos(clamp(dot(rd, normalize(uBody)), -1.0, 1.0));
          if (bd < uBodyR) {
            vec3 bn = normalize(rd - normalize(uBody) * cos(bd) ); float r = bd / uBodyR;
            vec3 nrm = normalize(-normalize(uBody) * sqrt(max(1.0 - r * r, 0.0)) + bn * r);
            float lb = max(dot(nrm, L), 0.0);
            vec3 bc = uBodyCol * (0.85 + 0.3 * n_fbm3(nrm * 6.0, 4)) * lb * 1.3;
            col = mix(col, bc, smoothstep(uBodyR, uBodyR * 0.97, bd));
          }
        }
        // the sun: a disc at this world's size, glare around it
        float disc = smoothstep(uSunR * 1.06, uSunR * 0.94, ang);
        col += uDisc * disc * uSunI * smoothstep(-0.02, 0.01, y);
        float g1 = exp(-ang / (0.006 + 0.08 * (1.0 - uGlareW))), g2 = exp(-ang / (0.05 + 0.5 * (1.0 - uGlareW)));
        col += uDisc * uGlare * (g1 * 1.6 + g2 * 0.16) * smoothstep(-0.05, 0.02, y);
        // Pluto: thin layers of blue haze hugging the horizon, brighter toward the sun
        if (uHaze > 0.0) {
          float hz = exp(-abs(y - 0.004) / 0.009) + 0.35 * exp(-abs(y - 0.022) / 0.006) + 0.18 * exp(-abs(y - 0.042) / 0.006);
          col += uHazeCol * uHaze * hz * (0.35 + 1.4 * pow(max(mu, 0.0), 4.0)) * smoothstep(-0.01, 0.004, y);
        }
        // lightning inside the deck: a flickering glow round the strike, the cloud texture lit from within
        if (uFlash > 0.0) {
          float fa = acos(clamp(dot(rd, normalize(uFlashDir)), -1.0, 1.0));
          float lit = exp(-fa / 0.22) * (0.6 + 0.8 * n_fbm2(rd.xz / (yy + 0.3) * 4.0 + 3.0, 4)) + exp(-fa / 0.9) * 0.25;
          col += vec3(1.0, 0.86, 0.7) * uFlash * lit * 2.2 * smoothstep(0.02, 0.2, yy);
        }
        // heat shimmer: a wavering bright band hugging the horizon (hot air bending the light)
        if (uShimmer > 0.0) {
          float wob = (n_fbm2(vec2(atan(rd.x, rd.z) * 24.0, uTime * 1.3), 3) - 0.5) * 0.012;
          float hb = exp(-abs(y - 0.004 - wob) / 0.006) * (0.6 + 0.4 * sin(atan(rd.x, rd.z) * 90.0 + uTime * 6.0 + wob * 400.0));
          col += hor * uDay * hb * 0.35 * uShimmer;
        }
        // under the horizon (behind the ground anyway): the horizon colour, darker
        col = mix(col, hor * uDay * 0.6, smoothstep(0.0, -0.06, y));
        gl_FragColor = vec4(col, 1.0);
      }`,
    depthWrite: false, depthTest: false, side: THREE.BackSide, fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(100, 64, 32), mat);
  mesh.frustumCulled = false; mesh.renderOrder = -1e6 + 1.5; mesh.name = 'e4.sky'; mesh.userData.noQA = true;
  mesh.onBeforeRender = (r, s, cam) => { mesh.position.copy(cam.position); mesh.updateMatrixWorld(); };
  return { mesh, mat, u };
}

// ── dust motes: tiny particles lifted in thin air, drifting with the wind, wrapped round the camera ─────────────────
export function dustMotes(o = {}) {
  const n = o.count ?? 1400, S = o.box ?? 46, R = rng(o.seed ?? 11);
  const pos = new Float32Array(n * 3), rnd = new Float32Array(n);
  for (let i = 0; i < n; i++) { pos[i * 3] = R() * S; pos[i * 3 + 1] = R() * S * 0.5; pos[i * 3 + 2] = R() * S; rnd[i] = R(); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aR', new THREE.BufferAttribute(rnd, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uS: { value: S }, uWind: { value: new THREE.Vector3(...(o.wind || [1.4, 0.15, 0.4])) }, uCol: { value: new THREE.Color(...(o.color || [0.9, 0.62, 0.4])) },
      uSize: { value: (o.size ?? 0.9) * (o.pxScale ?? 1) }, uAmt: { value: o.amount ?? 1 }, uGround: { value: o.groundY ?? 0 } },
    vertexShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_vertex>
      attribute float aR; uniform float uTime, uS, uSize, uGround; uniform vec3 uCam, uWind; varying float vA;
      void main(){
        vec3 p = position + uWind * uTime * (0.6 + 0.8 * aR) + vec3(sin(uTime * (0.3 + aR) + aR * 20.0), sin(uTime * 0.5 + aR * 9.0) * 0.6, cos(uTime * (0.4 + aR) + aR * 13.0)) * 0.6;
        vec3 base = uCam - vec3(uS * 0.5, 0.0, uS * 0.5);
        p.xz = mod(p.xz - base.xz, uS) + base.xz;
        p.y = uGround + 0.2 + mod(p.y, uS * 0.5) * (0.35 + 0.65 * aR);
        vec4 mv = viewMatrix * vec4(p, 1.0);
        float d = -mv.z;
        vA = smoothstep(0.4, 2.0, d) * (1.0 - smoothstep(uS * 0.3, uS * 0.5, d));
        gl_PointSize = uSize * (0.6 + 0.8 * aR) * 18.0 / max(d, 0.5);
        gl_Position = projectionMatrix * mv;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform vec3 uCol; uniform float uAmt; varying float vA;
      void main(){
        #include <logdepthbuf_fragment>
        vec2 q = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.1, length(q)) * vA * 0.32 * uAmt;
        if (a < 0.003) discard;
        gl_FragColor = vec4(uCol * a, a);
      }`,
    transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  const pts = new THREE.Points(g, mat); pts.frustumCulled = false; pts.name = 'e4.dust'; pts.userData.noQA = true; pts.renderOrder = 5;
  return { mesh: pts, update(t, camera) { mat.uniforms.uTime.value = t; if (camera) mat.uniforms.uCam.value.copy(camera.position); } };
}

// ── haze veils: huge soft sheets of dense air drifting through the view (Venus, Titan), with a rising heat shimmer ────
export function hazeVeils(o = {}) {
  const n = o.count ?? 22, R = rng(o.seed ?? 7), G = o.ground || ((x, z) => 0);
  const grp = new THREE.Group(); grp.name = 'e4.veils'; grp.userData.noQA = true;
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uCol: { value: new THREE.Color(...(o.color || [0.9, 0.45, 0.14])) }, uAmt: { value: o.amount ?? 1 }, uShim: { value: o.shimmer ?? 1 } },
    vertexShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec2 vUv; varying float vD; varying vec3 vW;
      void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vec4 mv = viewMatrix * w; vD = -mv.z; gl_Position = projectionMatrix * mv;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform float uTime, uAmt, uShim; uniform vec3 uCol; varying vec2 vUv; varying float vD; varying vec3 vW;
      ${NOISE_GLSL}
      void main(){
        #include <logdepthbuf_fragment>
        float edge = smoothstep(0.0, 0.25, vUv.x) * smoothstep(1.0, 0.75, vUv.x) * smoothstep(1.0, 0.35, vUv.y) * smoothstep(0.0, 0.06, vUv.y);
        vec2 q = vec2(vW.x + vW.z, vW.y) * vec2(0.006, 0.012);
        float n = n_fbm2(q + vec2(uTime * 0.01, -uTime * 0.02), 5);
        float sh = n_fbm2(vec2((vW.x + vW.z) * 0.08, vW.y * 0.25 - uTime * 1.6), 3);        // rising shimmer
        float a = smoothstep(0.35, 0.8, n) * edge * 0.3 * uAmt;
        a += (sh - 0.5) * 0.06 * uShim * edge * smoothstep(0.45, 0.0, vUv.y);
        a *= smoothstep(8.0, 60.0, vD);
        a = clamp(a, 0.0, 0.5);
        if (a < 0.002) discard;
        gl_FragColor = vec4(uCol * a, a);
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  const cx = o.center?.[0] ?? 0, cz = o.center?.[1] ?? 0, r0 = o.r0 ?? 40, r1 = o.r1 ?? 700;
  for (let i = 0; i < n; i++) {
    const a = R() * Math.PI * 2, r = r0 + Math.pow(R(), 0.8) * (r1 - r0), w = 120 + R() * 380, h = 30 + R() * 90;
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    const g = new THREE.PlaneGeometry(w, h); g.translate(0, h / 2, 0);
    const m = new THREE.Mesh(g, mat); m.position.set(x, G(x, z) - 4, z); m.rotation.y = a + Math.PI / 2 + (R() - 0.5) * 0.8; m.renderOrder = 4; m.frustumCulled = false;
    grp.add(m);
  }
  return { mesh: grp, update(t) { mat.uniforms.uTime.value = t; } };
}
