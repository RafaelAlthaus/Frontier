// materials.js — MeshStandardMaterial variants used across the world, all with the shared height fog:
//   masonry()     UVs in metres (geometry builders write them), world-space grime + a darker foot
//   triplanar()   rocks, terrain faces: colour + whiteout-blended normals projected on the three axes
//   plain()       anything else
import * as THREE from 'three';
import { patchMaterial, U } from './env.js';

let GRIME = null;
export function setGrime(t) { GRIME = t; }

function setRepeat(t, m) { if (t) { t.repeat.set(1 / m, 1 / m); } }

export function plain(o = {}) {
  const m = new THREE.MeshStandardMaterial(o);
  return patchMaterial(m);
}

// stone with UVs in metres. grime: world-space blotches + vertical streaks, darker toward the ground / sea
export function masonry(tex, o = {}) {
  const map = tex.map.clone(), nm = tex.normalMap.clone(), rm = tex.roughnessMap.clone();
  for (const t of [map, nm, rm]) { t.needsUpdate = true; setRepeat(t, tex.meters); }
  const m = new THREE.MeshStandardMaterial({
    map, normalMap: nm, roughnessMap: rm, roughness: 1, metalness: 0,
    normalScale: new THREE.Vector2(o.normal ?? 1, o.normal ?? 1), color: o.color ?? 0xffffff,
    envMapIntensity: o.env ?? 0.6,
  });
  m.userData.progKey = 'masonry';
  const grime = o.grime ?? 0.5, foot = o.foot ?? 0.35, streak = o.streak ?? 0.35;
  return patchMaterial(m, (shader) => {
    shader.uniforms.uGrime = { value: GRIME };
    shader.uniforms.uGrimeAmt = { value: new THREE.Vector3(grime, foot, streak) };
    shader.uniforms.uWet = U.uWet;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGW;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        { vec4 gw = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          gw = instanceMatrix * gw;
        #endif
          vGW = (modelMatrix * gw).xyz; }`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGW; uniform sampler2D uGrime; uniform vec3 uGrimeAmt; uniform float uWet;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        { vec3 g1 = texture2D(uGrime, vGW.xz * 0.013 + vGW.y * 0.004).rgb;
          vec3 g2 = texture2D(uGrime, vec2(vGW.x + vGW.z, vGW.y * 0.35) * 0.02).rgb;
          float blot = smoothstep(0.35, 0.75, g1.r) * uGrimeAmt.x;
          float streak = smoothstep(0.45, 0.8, g2.g) * uGrimeAmt.z;
          float foot = (1.0 - smoothstep(0.0, 9.0, vGW.y)) * uGrimeAmt.y;
          float dark = clamp(blot * 0.28 + streak * 0.22 + foot * 0.45, 0.0, 0.7);
          diffuseColor.rgb *= 1.0 - dark;
          diffuseColor.rgb *= mix(vec3(1.0), vec3(0.93, 0.96, 0.9), smoothstep(0.55, 0.9, g2.r) * 0.5 * uGrimeAmt.x);
          diffuseColor.rgb *= 1.0 - uWet * 0.35; }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.25, uWet);`);
  });
}

// triplanar colour + normals in world space (rocks, cliffs, ground)
export function triplanar(tex, o = {}) {
  const m = new THREE.MeshStandardMaterial({ color: o.color ?? 0xffffff, roughness: o.roughness ?? 0.9, metalness: 0, envMapIntensity: o.env ?? 0.5 });
  m.userData.progKey = 'triplanar' + (o.wetLine ? 'W' : '');
  return patchMaterial(m, (shader) => {
    shader.uniforms.uTriMap = { value: tex.map };
    shader.uniforms.uTriNormal = { value: tex.normalMap };
    shader.uniforms.uTriScale = { value: 1 / (o.scale ?? 6) };
    shader.uniforms.uTriN = { value: o.normal ?? 1.0 };
    shader.uniforms.uGrime = { value: GRIME };
    shader.uniforms.uWet = U.uWet;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTP; varying vec3 vTN;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        { vec4 tw = vec4(transformed, 1.0); vec3 tn = objectNormal;
        #ifdef USE_INSTANCING
          tw = instanceMatrix * tw; tn = mat3(instanceMatrix) * tn;
        #endif
          vTP = (modelMatrix * tw).xyz; vTN = normalize(mat3(modelMatrix) * tn); }`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vTP; varying vec3 vTN; uniform sampler2D uTriMap; uniform sampler2D uTriNormal; uniform float uTriScale; uniform float uTriN;
        uniform sampler2D uGrime; uniform float uWet;`)
      .replace('#include <map_fragment>', `
        vec3 tbw = pow(abs(normalize(vTN)), vec3(4.0)); tbw /= dot(tbw, vec3(1.0));
        vec3 tcol = texture2D(uTriMap, vTP.zy * uTriScale).rgb * tbw.x + texture2D(uTriMap, vTP.xz * uTriScale).rgb * tbw.y + texture2D(uTriMap, vTP.xy * uTriScale).rgb * tbw.z;
        float tgr = texture2D(uGrime, vTP.xz * 0.004).r;
        diffuseColor.rgb *= tcol * (0.85 + 0.3 * tgr);
        ${o.wetLine ? `{ float wl = 1.0 - smoothstep(0.2, 1.6, vTP.y); diffuseColor.rgb *= 1.0 - wl * 0.55; diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.8, 0.9, 0.75), (1.0 - smoothstep(-0.5, 0.6, vTP.y)) * 0.6); }` : ''}
        diffuseColor.rgb *= 1.0 - uWet * 0.3;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        ${o.wetLine ? 'roughnessFactor = mix(roughnessFactor, 0.35, 1.0 - smoothstep(0.1, 1.2, vTP.y));' : ''}
        roughnessFactor = mix(roughnessFactor, 0.3, uWet);`)
      .replace('#include <normal_fragment_maps>', `
        { vec3 Nw = normalize(vTN);
          vec3 tX = texture2D(uTriNormal, vTP.zy * uTriScale).xyz * 2.0 - 1.0;
          vec3 tY = texture2D(uTriNormal, vTP.xz * uTriScale).xyz * 2.0 - 1.0;
          vec3 tZ = texture2D(uTriNormal, vTP.xy * uTriScale).xyz * 2.0 - 1.0;
          tX.xy *= uTriN; tY.xy *= uTriN; tZ.xy *= uTriN;
          tX = vec3(tX.xy + Nw.zy, abs(tX.z) * Nw.x);
          tY = vec3(tY.xy + Nw.xz, abs(tY.z) * Nw.y);
          tZ = vec3(tZ.xy + Nw.xy, abs(tZ.z) * Nw.z);
          vec3 wN = normalize(tX.zyx * tbw.x + tY.xzy * tbw.y + tZ.xyz * tbw.z);
          normal = normalize((viewMatrix * vec4(wN, 0.0)).xyz); }`);
  });
}
