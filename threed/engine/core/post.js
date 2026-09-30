// post.js — the camera's film (adapted from the Pharos world): N sub-frames per frame averaged in HDR (180-degree
// shutter motion blur + the lens-aperture samples of the DOF), bloom, then one grade pass: exposure, ACES filmic,
// contrast, lift/gamma/gain, split toning, saturation, sepia/mono mix, a subtle vignette, deterministic grain, and the
// whiteout transition (the frame fills with drifting cloud). Grain is seeded by the frame number derived from t, so a
// re-rendered frame is identical. Last, on the graded 8-bit frame, the WARP transition: since E1 v2 a clean, colour-
// neutral whip pan (horizontal smear + slide, 0.15 s either side of the cut); edges reflect like cv2.BORDER_REFLECT.
import * as THREE from 'three';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

const QUAD_VS = /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

export const GRADE = {
  exposure: 1, lift: [0.006, 0.006, 0.007], gamma: [1, 1, 1], gain: [1, 1, 1], sat: 1.0,
  shadowTint: [0, 0, 0], highTint: [0, 0, 0], vignette: 0.26, grain: 0.018,
  mono: 0, ink: [0.082, 0.07, 0.055], paper: [0.96, 0.9, 0.78], contrast: 1.05, bloom: 0.22,
  white: 0, whiteCol: [0.92, 0.93, 0.95], warp: 0,
  // Q5 filmic print curve: `contrast` drives the S (curve = 0.3 + (contrast - 1.05) * 1.6 unless given), `pivot` is its
  // display-space centre, `toe` scales it below the pivot (night/space keep their shadows), `shoulder` is where the
  // highlight roll-off starts (nothing reaches 1.0: no clipped whites). Bloom: only the energy above `bloomT` (exposed
  // units, max channel, soft knee) blooms, so fire, lava, lightning and the sun glow while sunlit white does not.
  pivot: 0.45, toe: 1, shoulder: 0.86, bloomT: 2.3,
};

// the five looks the spec can ask for ("grade"); every key is a delta on GRADE
export const GRADES = {
  neutral: {},
  warm: { gain: [1.045, 1.0, 0.93], shadowTint: [-0.004, 0.0, 0.006], highTint: [0.02, 0.01, -0.016], sat: 1.02, contrast: 1.07 },
  cold: { gain: [0.94, 0.995, 1.06], shadowTint: [0.0, 0.004, 0.012], highTint: [-0.006, 0.0, 0.012], sat: 0.88, contrast: 1.06, lift: [0.008, 0.01, 0.014] },
  sepia: { mono: 0.62, sat: 0.4, contrast: 1.08, lift: [0.018, 0.014, 0.01], vignette: 0.34, grain: 0.024 },
  bleach: { sat: 0.5, contrast: 1.24, lift: [0.004, 0.004, 0.005], gain: [0.99, 1.0, 1.01], highTint: [0.006, 0.006, 0.004], vignette: 0.32 },
};

export function makePost(renderer, W, H) {
  const rtScene = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples: 4 });
  const rtAcc = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType });
  const quadGeo = new THREE.PlaneGeometry(2, 2);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const accMat = new THREE.ShaderMaterial({
    uniforms: { tSrc: { value: rtScene.texture }, uW: { value: 1 } },
    vertexShader: QUAD_VS,
    fragmentShader: `uniform sampler2D tSrc; uniform float uW; varying vec2 vUv;
      void main(){ vec3 c = texture2D(tSrc, vUv).rgb; c = clamp(c, vec3(0.0), vec3(250.0)); gl_FragColor = vec4(c * uW, 1.0); }`,
    depthTest: false, depthWrite: false, blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendEquation: THREE.AddEquation,
  });
  const accScene = new THREE.Scene(); accScene.add(new THREE.Mesh(quadGeo, accMat));

  const bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0.3, 0.35, 2.4);
  // Q5: soft-knee excess on the brightest channel instead of the full texel above a luminance step: a sunlit white
  // wall just over the threshold adds a trace, a flame or a bolt far over it blooms (hot orange counts by its red)
  bloom.materialHighPassFilter.fragmentShader = /* glsl */`
    uniform sampler2D tDiffuse; uniform float luminosityThreshold; uniform float smoothWidth; varying vec2 vUv;
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float br = max(c.r, max(c.g, c.b)), T = luminosityThreshold, K = T * 0.5;
      float soft = clamp(br - T + K, 0.0, 2.0 * K); soft = soft * soft / (4.0 * K + 1e-5);
      gl_FragColor = vec4(c * (max(soft, br - T) / max(br, 1e-4)), 1.0);
    }`;
  bloom.materialHighPassFilter.needsUpdate = true;

  const gradeMat = new THREE.ShaderMaterial({
    uniforms: {
      tSrc: { value: rtAcc.texture }, uExposure: { value: 1 }, uFrame: { value: 0 }, uRes: { value: new THREE.Vector2(W, H) },
      uLift: { value: new THREE.Vector3() }, uGamma: { value: new THREE.Vector3(1, 1, 1) }, uGain: { value: new THREE.Vector3(1, 1, 1) },
      uSat: { value: 1 }, uShadowTint: { value: new THREE.Vector3() }, uHighTint: { value: new THREE.Vector3() },
      uVignette: { value: 0.3 }, uGrain: { value: 0.03 }, uMono: { value: 0 }, uInk: { value: new THREE.Vector3() },
      uPaper: { value: new THREE.Vector3(1, 1, 1) }, uContrast: { value: 1 }, uFade: { value: 0 }, uFadeCol: { value: new THREE.Vector3() },
      uWhite: { value: 0 }, uWhiteCol: { value: new THREE.Vector3(1, 1, 1) }, uTime: { value: 0 },
      uCurve: { value: 0.3 }, uPivot: { value: 0.45 }, uToe: { value: 1 }, uShoulder: { value: 0.86 },
    },
    vertexShader: QUAD_VS,
    fragmentShader: /* glsl */`
      uniform sampler2D tSrc; uniform float uExposure; uniform float uFrame; uniform vec2 uRes;
      uniform vec3 uLift; uniform vec3 uGamma; uniform vec3 uGain; uniform float uSat;
      uniform vec3 uShadowTint; uniform vec3 uHighTint; uniform float uVignette; uniform float uGrain;
      uniform float uMono; uniform vec3 uInk; uniform vec3 uPaper; uniform float uContrast; uniform float uFade; uniform vec3 uFadeCol;
      uniform float uWhite; uniform vec3 uWhiteCol; uniform float uTime;
      uniform float uCurve; uniform float uPivot; uniform float uToe; uniform float uShoulder;
      varying vec2 vUv;
      // print curve: mixes toward two power curves that meet at the pivot (slope 1.9 there, 0 at 0 and 1); the mix
      // weight is uToe below the pivot, 1 above, blended smoothly, so the curve stays C1 and inside 0..1
      vec3 sCurve(vec3 x){
        x = clamp(x, 0.0, 1.0);
        vec3 lo = uPivot * pow(x / uPivot, vec3(1.9));
        vec3 hi = 1.0 - (1.0 - uPivot) * pow(max(1.0 - x, 0.0) / (1.0 - uPivot), vec3(1.9));
        vec3 y = mix(lo, hi, step(vec3(uPivot), x));
        vec3 k = uCurve * mix(vec3(uToe), vec3(1.0), smoothstep(0.0, uPivot * 1.4, x));
        return mix(x, y, k);
      }
      // highlight roll-off: linear to the knee, then a tanh shoulder that approaches but never reaches 1
      vec3 shoulder(vec3 x){
        float s = uShoulder;
        vec3 r = s + (1.0 - s) * tanh(max(x - s, 0.0) / (1.0 - s));
        return mix(x, r, step(vec3(s), x));
      }
      float hash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
      float vn(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y); }
      float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ s += a * vn(p); p = p * 2.03 + 11.7; a *= 0.5; } return s; }
      vec3 rrt(vec3 v){ vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
      vec3 aces(vec3 c){
        const mat3 AIn = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
        const mat3 AOut = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
        c = AOut * rrt(AIn * (c / 0.6));
        return clamp(c, 0.0, 1.0);
      }
      vec3 srgb(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
      void main(){
        vec3 c = texture2D(tSrc, vUv).rgb * uExposure;
        c = srgb(aces(c));
        c = sCurve(c);
        c = uGain * (c + uLift * (1.0 - c));
        c = pow(max(c, 0.0), 1.0 / uGamma);
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c += uShadowTint * (1.0 - smoothstep(0.0, 0.45, l)) + uHighTint * smoothstep(0.45, 1.0, l);
        c = mix(vec3(l), c, uSat);
        c = mix(c, mix(uInk, uPaper, smoothstep(0.0, 1.0, l)), uMono);
        vec2 q = vUv - 0.5;
        c *= 1.0 - uVignette * pow(dot(q * vec2(1.0, 0.8), q * vec2(1.0, 0.8)) * 2.2, 1.3);
        c = shoulder(c);
        // whiteout: drifting cloud billows thicken until they fill the frame
        if (uWhite > 0.0) {
          vec2 p = vec2(vUv.x * uRes.x / uRes.y, vUv.y) * 3.0;
          float n = fbm(p + vec2(uTime * 0.35, uTime * 0.12)) * 0.65 + fbm(p * 2.3 - vec2(uTime * 0.5, 0.0)) * 0.35;
          float cov = smoothstep(1.05 - uWhite * 1.25, 1.25 - uWhite * 1.25, n + 0.25 * length(q) * (1.0 - uWhite));
          cov = max(cov, smoothstep(0.75, 1.0, uWhite));
          vec3 wc = uWhiteCol * (0.9 + 0.12 * n);
          c = mix(c, wc, cov);
        }
        float n2 = hash(vUv * uRes + fract(uFrame * 0.618) * 1000.0) + hash(vUv * uRes * 1.37 - uFrame * 3.1) - 1.0;
        float lg = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c += n2 * uGrain * (0.45 + 2.2 * lg * (1.0 - lg));          // film grain sits in the mid-tones, per frame
        c = mix(c, uFadeCol, uFade);
        gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
      }`,
    depthTest: false, depthWrite: false,
  });
  const gradeScene = new THREE.Scene(); gradeScene.add(new THREE.Mesh(quadGeo, gradeMat));

  // the warp pass reads the graded frame from an 8-bit target (mirrored edges = cv2.BORDER_REFLECT)
  const rtGrade = new THREE.WebGLRenderTarget(W, H, { type: THREE.UnsignedByteType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  rtGrade.texture.wrapS = rtGrade.texture.wrapT = THREE.MirroredRepeatWrapping;
  // E1 v2 WARP = a whip pan: the graded frame smears sideways and slides with the whip, 0.15 s either side of the cut
  // (0.3 s in all), colour-neutral: no zoom streak, no chromatic split, no warm flash (that read as a glitch). uDir -1
  // on the outgoing side (the picture slides left), +1 on the incoming one (it arrives from the right and settles), so
  // both halves read as one whip. 40 taps with a per-pixel offset: a soft streak, never ghost copies.
  const warpMat = new THREE.ShaderMaterial({
    uniforms: { tSrc: { value: rtGrade.texture }, uW: { value: 0 }, uDir: { value: -1 }, uRes: { value: new THREE.Vector2(W, H) } },
    vertexShader: QUAD_VS,
    fragmentShader: /* glsl */`
      uniform sampler2D tSrc; uniform float uW; uniform float uDir; uniform vec2 uRes; varying vec2 vUv;
      float hsh(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
      void main(){
        float w = clamp(uW, 0.0, 1.0), e = w * w;
        float L = 0.45 * e, off = uDir * 0.18 * e;
        float j = hsh(vUv * uRes) - 0.5;
        vec3 acc = vec3(0.0); float ws = 0.0;
        for (int i = 0; i < 40; i++) {
          float u = (float(i) + 0.5 + j) / 40.0 - 0.5;
          float k = 1.0 - abs(u) * 1.6;
          acc += texture2D(tSrc, vec2(vUv.x - off + u * L, vUv.y)).rgb * k; ws += k;
        }
        gl_FragColor = vec4(clamp(acc / ws, 0.0, 1.0), 1.0);
      }`,
    depthTest: false, depthWrite: false,
  });
  const warpScene = new THREE.Scene(); warpScene.add(new THREE.Mesh(quadGeo, warpMat));

  function setGrade(g) {
    const u = gradeMat.uniforms;
    u.uExposure.value = g.exposure;
    u.uLift.value.set(...g.lift); u.uGamma.value.set(...g.gamma); u.uGain.value.set(...g.gain);
    u.uSat.value = g.sat; u.uShadowTint.value.set(...g.shadowTint); u.uHighTint.value.set(...g.highTint);
    u.uVignette.value = g.vignette; u.uGrain.value = g.grain; u.uMono.value = g.mono;
    u.uInk.value.set(...g.ink); u.uPaper.value.set(...g.paper); u.uContrast.value = g.contrast;
    u.uFade.value = g.fade ?? 0; u.uFadeCol.value.set(...(g.fadeCol ?? [0, 0, 0]));
    u.uWhite.value = g.white ?? 0; u.uWhiteCol.value.set(...(g.whiteCol ?? [1, 1, 1]));
    u.uCurve.value = Math.min(0.9, Math.max(0, g.curve ?? 0.3 + (g.contrast - 1.05) * 1.6));
    u.uPivot.value = g.pivot ?? 0.45; u.uToe.value = g.toe ?? 1; u.uShoulder.value = g.shoulder ?? 0.86;
    bloom.strength = g.bloom;
    bloom.threshold = (g.bloomT ?? 2.3) / Math.max(0.05, g.exposure);     // exposed units -> the HDR buffer's units
  }

  // one frame: renderSub(j) renders the scene into rtScene for sub-frame j (0..n-1)
  function frame(n, renderSub, frameNo, grade, t) {
    renderer.setRenderTarget(rtAcc);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, false, false);
    for (let j = 0; j < n; j++) {
      renderer.setRenderTarget(rtScene);
      renderSub(j, rtScene);
      accMat.uniforms.uW.value = 1 / n;
      renderer.setRenderTarget(rtAcc);
      const ac = renderer.autoClear; renderer.autoClear = false;
      renderer.render(accScene, cam);
      renderer.autoClear = ac;
    }
    setGrade(grade);
    if (grade.bloom > 0) bloom.render(renderer, null, rtAcc, 0, false);
    gradeMat.uniforms.uFrame.value = frameNo;
    gradeMat.uniforms.uTime.value = t ?? 0;
    const w = grade.warp ?? 0;
    if (w > 1e-3) {
      renderer.setRenderTarget(rtGrade); renderer.render(gradeScene, cam);
      warpMat.uniforms.uW.value = Math.min(1, w); warpMat.uniforms.uDir.value = grade.warpDir ?? -1;
      renderer.setRenderTarget(null); renderer.render(warpScene, cam);
    } else {
      renderer.setRenderTarget(null);
      renderer.render(gradeScene, cam);
    }
  }
  function dispose() { rtScene.dispose(); rtAcc.dispose(); rtGrade.dispose(); bloom.dispose(); }
  return { frame, rtScene, rtAcc, bloom, setGrade, dispose };
}
