// skin.js — a procedural mountain skin for the big FX slopes (the avalanche slope, the Lituya fjord wall), Q5.
// Erosion ribs and gullies run down the fall line (the mesh's local Z), rock shows on the steep parts, the ribs and the
// buttresses, snow lingers in the gullies and above a ragged snow line, and a dark forest floor becomes mottled crowns
// with brushy avalanche chutes. Colour, roughness and normals only: the geometry, and every FX staged on it, is
// untouched. Not a catalog module (no CATALOG): a helper the FX builders call.
//   skinField(lx, lz, seed) -> big (0..1): the 160 m buttress/bowl field, the same numbers the shader gets per vertex
//   mountainSkin(material, geometry, o) patches a MeshStandardMaterial (after ctx.patch) and adds the aSkBig attribute
//     ribs follow each surface's own fall line (from its normal); the buttress/stand/chute fields use the geometry's
//     local x, z (the FX slopes run down local Z)
//     o: { seed, rock (hex), rockSlope (1 - n.y where rock starts), snow (0..1 cover everywhere), snowLine (m, world y),
//          forest (0..1: a dark vertex colour is a forest floor), relief (bump, m), waterLine (world y: wet-dark above it) }
import * as THREE from 'three';
import { makeNoise } from '../shared/util.js';
import { NOISE_GLSL } from './tex.js';

const NZ = new Map();
export function skinField(lx, lz, seed = 1) {
  let n = NZ.get(seed); if (!n) { n = makeNoise(seed * 7 + 3); NZ.set(seed, n); }
  return Math.min(1, Math.max(0, 0.5 + 0.62 * n.fbm2(lx / 160 + 5.3, lz / 160 - 1.7, 3)));
}

export function mountainSkin(m, geo, o = {}) {
  const pos = geo.attributes.position, n = pos.count, seed = o.seed ?? 1;
  const big = new Float32Array(n);
  for (let i = 0; i < n; i++) big[i] = skinField(pos.getX(i), pos.getZ(i), seed);
  geo.setAttribute('aSkBig', new THREE.BufferAttribute(big, 1));
  const u = {
    uSkRock: { value: new THREE.Color(o.rock ?? 0x6c675f) }, uSkRockSlope: { value: o.rockSlope ?? 0.3 },
    uSkSnow: { value: o.snow ?? 0 }, uSkSnowLine: { value: o.snowLine ?? 1e5 }, uSkForest: { value: o.forest ?? 0 },
    uSkRelief: { value: o.relief ?? 1 }, uSkWet: { value: o.waterLine ?? -1e5 },
  };
  m.userData.skin = u;
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aSkBig; varying float vSkBig; varying vec3 vSkW; varying vec3 vSkL; varying vec3 vSkN;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vSkBig = aSkBig; vSkL = transformed; vSkW = (modelMatrix * vec4(transformed, 1.0)).xyz; vSkN = normalize(mat3(modelMatrix) * objectNormal);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vSkBig; varying vec3 vSkW; varying vec3 vSkL; varying vec3 vSkN;
        uniform vec3 uSkRock; uniform float uSkRockSlope, uSkSnow, uSkSnowLine, uSkForest, uSkRelief, uSkWet;
        ${NOISE_GLSL}
        float skRock, skH, skSnow;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 P = vSkW; vec2 q = vSkL.xz; vec3 Nw = normalize(vSkN);
          float slope = 1.0 - abs(Nw.y);
          float dist = length(P - cameraPosition);
          float far = smoothstep(250.0, 1400.0, dist);
          // erosion: ribs (1) and gullies (0) down the fall line, two scales; the finer one fades out with distance.
          // (The bump uses these smooth shader fields only: the per-vertex buttress field is linear per triangle and
          // would facet the shading.)
          // (the fall line comes from the surface normal, so side walls get their own gullies, not the main face's)
          vec2 fall = normalize(Nw.xz + 1e-5), ep = vec2(dot(P.xz, vec2(-fall.y, fall.x)), dot(P.xz, fall));
          float r1 = 1.0 - abs(2.0 * n_v2(vec2(ep.x / 19.0, ep.y / 110.0)) - 1.0);
          float r2 = 1.0 - abs(2.0 * n_v2(vec2(ep.x / 7.0 + 3.1, ep.y / 42.0 - 1.7)) - 1.0);
          float ero = mix(0.5, mix(r1 * 0.62 + r2 * 0.38, r1, far), smoothstep(0.06, 0.2, slope));
          float eroM = mix(ero, 0.5, smoothstep(600.0, 1800.0, dist));          // far away no rib comb in the masks
          float mid = n_v2(q / 55.0 + 9.1);
          float big = vSkBig;
          float fine = mix(n_v2(P.xz * 0.45) * 0.6 + n_v2(P.xz * 1.3 + 7.0) * 0.4, 0.5, far);
          skH = (ero - 0.5) * 2.2 * uSkRelief;
          // rock: steep ground, rib crests and the buttresses (big), broken up along the strata
          skRock = smoothstep(uSkRockSlope - 0.03, uSkRockSlope + 0.03, slope + 0.22 * (eroM - 0.5) + 0.3 * (big - 0.5) + 0.08 * (mid - 0.5) + 0.05 * (fine - 0.5));
          // (no regular strata bands: at a few hundred metres they alias into scanlines) — irregular ledges instead
          vec3 rockCol = uSkRock * (0.7 + 0.42 * fine) * (0.88 + 0.12 * n_v2(vec2(q.x / 60.0, P.y / 9.0) + 2.3)) * (0.85 + 0.3 * eroM);
          vec3 base = diffuseColor.rgb;
          // a dark forest floor (the vertex colour) becomes mottled crowns in stands of different age, with brushy
          // avalanche chutes running down the fall line and bare rock on the buttresses (the trees there are hidden)
          float forest = uSkForest * (1.0 - smoothstep(0.17, 0.3, dot(base, vec3(0.3333))));
          if (forest > 0.01) {
            vec2 cq = P.xz / 7.5; vec2 id = floor(cq); vec2 f = fract(cq) - 0.5 - (vec2(n_h12(id), n_h12(id + 7.1)) - 0.5) * 0.6;
            float crown = 1.0 - smoothstep(0.08, 0.5, length(f));
            crown = mix(crown, 0.5, far);
            float stand = n_v2(q / 150.0 + 3.7) * 0.6 + n_v2(q / 60.0 - 1.3) * 0.4;
            vec3 canopy = base * mix(0.6, 1.12, crown) * (0.84 + 0.32 * n_h12(id + 3.3) * (1.0 - far)) * vec3(0.92, 1.0, 0.95) * (0.72 + 0.5 * stand);
            float chl = 1.0 - abs(2.0 * n_v2(vec2(q.x / 55.0 + 11.0, q.y / 480.0)) - 1.0);
            float chute = smoothstep(0.86, 0.96, chl) * smoothstep(0.3, 0.5, big) * (1.0 - smoothstep(0.6, 0.66, big));
            canopy = mix(canopy, base * vec3(1.6, 1.5, 1.1) * (0.85 + 0.3 * fine), chute * 0.8);
            base = mix(base, canopy, forest);
            skRock = max(skRock, forest * smoothstep(0.61, 0.66, big + 0.04 * (ero - 0.5)));
          }
          // above the trees and below the snow: bare rock and scree (the fjord's alpine band)
          float alpine = uSkForest * smoothstep(uSkSnowLine - 120.0, uSkSnowLine - 45.0, P.y + 50.0 * (big - 0.5) + 30.0 * (mid - 0.5) + 8.0 * (eroM - 0.5));
          base = mix(base, rockCol * (0.9 + 0.2 * fine), alpine * 0.85);
          // snow: the cover given (avalanche) or above a ragged line (the fjord's cap); it clings to the gullies and
          // slides off the steepest rock
          float line = smoothstep(uSkSnowLine - 22.0, uSkSnowLine + 22.0, P.y + 70.0 * (big - 0.5) + 40.0 * (mid - 0.5) + 12.0 * (0.5 - eroM));
          skSnow = max(uSkSnow, line) * (1.0 - smoothstep(0.42 + 0.16 * uSkSnow, 0.62 + 0.16 * uSkSnow, slope + 0.3 * (ero - 0.5)));   // a snowfield holds it longer
          vec3 snowCol = vec3(0.93, 0.95, 0.975) * (0.94 + 0.06 * fine) * mix(vec3(0.88, 0.93, 1.0), vec3(1.0), smoothstep(0.1, 0.6, ero));
          vec3 col = mix(base, snowCol, skSnow);
          float rockVis = skRock * (1.0 - skSnow * (1.0 - smoothstep(0.45, 0.8, eroM)) * 0.85);
          col = mix(col, rockCol, rockVis);
          skRock = rockVis;
          col *= mix(0.52, 1.0, smoothstep(uSkWet + 1.0, uSkWet + 9.0, P.y));      // wet-dark just above the waterline
          diffuseColor.rgb = col;
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.82, skRock);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = n_bump(-vViewPosition, normal, skH * (0.45 + 0.55 * skRock) * (1.0 - smoothstep(1500.0, 4000.0, length(vSkW - cameraPosition))));`);
  };
  const key = (m.customProgramCacheKey ? m.customProgramCacheKey() : '') + '|mskin1';
  m.customProgramCacheKey = () => key;
  m.needsUpdate = true;
  return m;
}
