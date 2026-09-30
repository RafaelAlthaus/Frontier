/* almanac.js — the ALMANAC kit: history of people and things, told like an encyclopedia entry or a collector's card.
   Three printed inks (mustard / yellow, ink black, paper white) on a charcoal ground or a clean white page;
   horizontal BANDS and BARS as the structure; REAL cut-out photographs with soft shadows that overlap the type;
   heavy grotesque titles whose letters rise one by one out of a mask line with a small overshoot; small secondary type
   fading in line by line; printed-matter texture on the card; every piece of film graded into the same two inks.
   Seven scenes, one registry (SCENES[S.type], dispatched by core's build() / frame(t)):
     bar       reference A: a person's cut-out on a white page, a dark bar grown behind it, the name rising in yellow
     card      reference B: the collector's card; mustard band, black title, an object's cut-out landing on the title
     reel      the card's stripe is a strip of 35 mm film, every cell its own shot: it spins up and coasts down onto
               the gate frame, the camera dives into it and the film becomes the screen
     hand      a deck fans into a hand of 2-5 collector cards of real people; one is pulled and turned to the lens
     tally     a figure too long for the frame: every digit is a cash-register drum, the camera dollies along it
     cardwall  full-frame archive film cracks into a wall of cards that flip in a wave and fuse into one card
     register  the page printed while you watch: three ink plates snap into register, the portrait resolves and
               peels off the page, a red proof stamp slams the verdict
   The page never opens a file: almanac_prep.py (run by kits._with_props) turns footage clips into frame lists and
   cut-out paths into data URIs with their face / edge metadata before the page is built.
   Fonts: Kit Sans (Inter variable, 100-900). This file is core.js followed by one section per scene, in the order
   above; every section opens with its own header (parameters, timeline, measured geometry). */

/* core.js — the ALMANAC kit: the scene registry and the helpers every ALMANAC scene is built from.

   ALMANAC reads like an encyclopedia entry or a collector's card: three printed inks (mustard / yellow,
   ink black, paper white) on a charcoal ground or a white page; horizontal BANDS and BARS as the structure;
   REAL cut-out photographs with soft shadows that overlap the type; heavy grotesque titles whose letters rise
   one by one out of a mask line with a small overshoot; small secondary type fading in line by line;
   printed-matter texture on the card.

   Every number in here was measured frame by frame off the two reference animations (30 fps, 1920x1080):
     A  "Sam Giancana"  white page, shutter opening, dark bar grown from the right edge behind a B&W cut-out,
                        yellow name rising out of the bar's bottom edge, black subtitle fading in.
     B  "ROVER V8"      charcoal ground, rounded black card popping in, mustard band grown down, black title
                        rising out of the band's bottom edge, colour cut-out landing on top, charcoal stripe
                        grown left to right, paper band grown up, grey engraved paragraph fading in line by line.
   Both references are rendered WITHOUT motion blur. The Frontier renderer averages 3 sub-frames per frame
   (kits.SHUTTER = 3), which turns every fast move into three stacked ghosts, so ALMANAC scenes quantise their
   clock with almSharp(t) and move in whole frames like the references. Only a move that SHOULD smear (the reel's
   spin-up) reads the raw t.

   Assembly: this file owns the ONLY build() and frame(t); every scene file registers SCENES.<type> = {build,
   frame} and adds nothing else at top level except helpers prefixed with its own name.

   ═══ HELPER INDEX ═══════════════════════════════════════════════════════════════════════════════════════════
   name                    arguments                                   what it does                         used by
   ─ registry / clock / maths ──────────────────────────────────────────────────────────────────────────────────
   SCENES, build, frame                                                 the registry and the dispatch        all
   ALM                     (object)                                     inks, weights, fonts, fps            all
   almSharp(t)             t                                           t floored to the output frame: the   bar card + any scene
                                                                        3 shutter sub-frames see one time    matching the refs
   smooth(x)               x 0..1                                      clamped smoothstep: whole-frame moves all
   ease3(t, t0, dur)       t, start, duration                          eo3 of the clamped progress          all
   spring(tau, z, w)       time since release, zeta, omega             damped spring remainder (1 → 0)      riseFrame
   almRng(seed)            seed                                        private mulberry32 generator         textures, stamp
   almPx(v)                number                                      'NN.NNpx'                            layout
   almUnder(ink, paper)    two hex inks                                the ink to print under MULTIPLY so   register
                                                                        it lands on `ink` over `paper`
   ─ grounds / camera ─────────────────────────────────────────────────────────────────────────────────────────
   groundPage(color)                                                    A's clean white page                 bar tally register
   groundCharcoal(color, vignette)                                      B's charcoal ground                  card reel hand cardwall
   almCam(parent)          parent                                      a full-frame wrapper (the camera)    all
   breathe(el, t, t0, t1, amount, ox, oy)                               the slow push-in of the hold         all
   ─ the card and its print ─────────────────────────────────────────────────────────────────────────────────
   paperTexture(el|canvas, seed, o)                                     veins, dust, paper grain (3 layers)  cardFinish
   makeCard(o)             {x,y,w,h,r,ri,border,shade,fill,parent}      B's rounded black card               card reel hand cardwall tally
   cardFinish(C, o)        card handle, texture opts                    texture + inner shade on top         same
   cardFrame(C, t, t0)                                                  B's pop-in                           same
   almFill(parent, x, y, w, h, color)                                   a flat band of ink                   all
   bandWipe(el, p, dir)    el, eased progress, 'down|up|left|right'    a band growing from one edge (clip)  all
   ─ type ────────────────────────────────────────────────────────────────────────────────────────────────────
   almBaseline / almInk    size, weight(, family)                      baseline offset / ink metrics        rise fadeLines
   rise(parent, text, o)   one line                                    letters that rise out of a mask line all
   riseFrame(h, t, t0, rate)                                            spring each letter up                all
   riseEnd(h, t0, rate)                                                 when the last letter is still        all
   almWrap(text, size, weight, width, ls)                               the rows the browser would wrap to   riseLines, hand
   riseLines(parent, text|rows, o)                                      several rising rows, one after other hand (+ any)
   riseLinesFrame(h, t, t0) / riseLinesEnd(h, t0)                       drive / end time of riseLines        hand
   fadeLines(parent, text, o)                                           a paragraph set line by line         all
   fadeLinesFrame(h, t, t0, stagger, dur, pow)                          line k fades in after line k-1       all
   ALM_ENGRAVE             (CSS text-shadow)                            B's letterpressed paragraph          card reel tally hand
   ─ photographs ─────────────────────────────────────────────────────────────────────────────────────────────
   almSrc(v) / almCut(v)   string or {src, ar, face, edges, nat, top}  a cut-out's URL / its prep metadata  cutout, hand, register
   cutout(parent, src, o)  src (string or prep object)                 a transparent PNG with a soft shadow bar card hand tally register
   cutoutFrame(h, t, m)                                                 its landing (slide, turn, settle)    same
   almLift(el, p, o)       el, 0..1, {shadow,scale,dx,dy,rot,origin,base,baseTransform}
                                                                        a photo peeling off the page         cardwall register
   ─ footage ─────────────────────────────────────────────────────────────────────────────────────────────────
   almHoldReady(promise)                                                hold window.__ready until it settles reel tally cardwall register
   almGrade(ctx, x, y, w, h, grade, o)                                  THE film grade: mono, ink blacks,    reel tally cardwall
                                                                        paper whites (ALM_GRADE_FF = ffmpeg)
   almFootage(fo)          S.footage (prepped: frames, cuts, fps)      {imgs,n,fps,cuts,clipAt,idx,img,     reel tally cardwall
                                                                         draw(ctx, fi, x, y, w, h, o), levels}
                           fo.levels 'auto' (opt-in)                   per-clip exposure before the grade   reel
   almLevelsCss / almLevelsFF (lv)                                      that exposure as CSS / as ffmpeg     reel, plain footage
   ─ numbers ─────────────────────────────────────────────────────────────────────────────────────────────────
   almDrum(host, o)        {x, y, w, F, ink, under, blank, color}      one cash-register drum column        tally (+ ledger)
   almOdoPos(v, k)         value, power of ten                         odometer wheel position w/ carries   tally (+ ledger, yearroll)
   almJolt(t, times, amp, freq, decay, phase)                           summed damped kicks (sin | cos)      tally register
   almStamp(host, o)       {text, sub, color, rot, x, y, fitW, fitH, seed}
                                                                        the worn red proof stamp             register
   ─ the shutter ─────────────────────────────────────────────────────────────────────────────────────────────
   shutterBuild(parent, color) / shutter(t, el, t0)                     A's opening panel                    bar tally register
   ═══════════════════════════════════════════════════════════════════════════════════════════════════════════ */

const SCENES = {};
function build() {
  const s = SCENES[S.type];
  if (!s) throw new Error('almanac: no scene ' + S.type);
  almCss();
  s.build();
}
function frame(t) { SCENES[S.type].frame(t); }

/* ── inks & type ──────────────────────────────────────────────────────────────────────────────── */
// Measured medians off the reference pixels (the brief's rounder guesses in brackets):
// page #FFFFFF (A is pure white, not #F8F8F8), bar #2B2B2B, name yellow #F8D848, subtitle #111111,
// charcoal ground #282828, card interior #0E0E0E, mustard #E6BE61 (#E5BC5D), stripe #262626 (median 38),
// title ink #151515, engraved paragraph #CAC4BC, title keyline #FEFAF8 (B's rim is near-white, not cream).
// Paper: B's paper band reads (243.5, 241, 239.5) through the same decode. Inks are chosen by what they RENDER
// to after Frontier's yuv420p encode (flat patches, measured): #F3F1ED → (243,240,239) = the ref, so a flat paper
// is ALM.paper; under B's paper grain (2.2, ~4 levels darker) the band needs ALM.paperStock #F8F6F3 → (247,245,243).
// (#F4F1F0, the first per-pixel guess, renders pinkish: (245,240,242).)
// Weights: B's title strokes measure R 46 / O 47 / V 48–50 / 8 53–55 px at a 228 px cap (stem/cap ~0.21): Inter
// ~720–780, not 900 (0.28). wTitle is 780 today (R stem renders 53); 720 is the next check.
// A's name is Inter 700 (stem/cap 0.19). Scenes should use wTitle / wName, not 900, so one tweak reaches all.
const ALM = {
  page: '#FFFFFF', bar: '#2B2B2B', yellow: '#F8D848', sub: '#111111', shutter: '#282828',
  charcoal: '#282828', cardInk: '#0E0E0E', mustard: '#E6BE61', stripe: '#262626', paper: '#F3F1ED', paperStock: '#F8F6F3',
  ink: '#151515', engraved: '#CAC4BC', cream: '#FEFAF8', red: P.red || '#C8372D',
  wTitle: 780, wName: 700,
  font: "'Kit Sans',Inter,'Helvetica Neue',Helvetica,Arial,sans-serif",
  fps: 30,                    // Frontier's kits.FPS
  _bl: {}, _fid: 0,
};

function almCss() {
  if (document.getElementById('alm-css')) return;
  const st = document.createElement('style'); st.id = 'alm-css';
  st.textContent = `
  #scene{font-family:${ALM.font};font-optical-sizing:auto;font-kerning:normal;-webkit-font-smoothing:antialiased}
  .alm-cam{position:absolute;left:0;top:0;width:${W}px;height:${H}px;transform-origin:50% 50%}
  .alm-card{position:absolute;background:#000}
  .alm-in{position:absolute;overflow:hidden;isolation:isolate}
  .alm-fill{position:absolute}
  .alm-tex{position:absolute;left:0;top:0;pointer-events:none}
  .alm-shade{position:absolute;inset:0;pointer-events:none}
  .alm-rise{position:absolute;overflow:hidden}
  .alm-rline{position:absolute;white-space:pre}
  .alm-ch{position:absolute;top:0;white-space:pre}
  .alm-cut{position:absolute}
  .alm-cut img{position:absolute;left:0;top:0;width:100%;height:100%;object-fit:contain;display:block}
  .alm-lines{position:absolute}
  .alm-l{display:block;white-space:pre}
  .alm-shutter{position:absolute;left:0;top:0;transform-origin:50% 50%}
  .alm-drum{position:absolute;overflow:hidden}
  .alm-drum .alm-strip{position:absolute;left:0;top:0;width:100%;height:100%}
  .alm-drum .alm-num{position:absolute;left:0;top:0;white-space:pre;transform-origin:50% 50%}
  .alm-stamp{position:absolute;left:0;top:0;transform-origin:50% 50%}`;
  document.head.appendChild(st);
}

/* ── the clock & small maths ──────────────────────────────────────────────────────────────────── */
// The output frame a render time belongs to. Frontier samples its shutter sub-frames at k/30 + j·0.5/30/shutter,
// so every sub-frame of output frame k floors to k/30: whatever reads almSharp(t) is razor-sharp at any shutter,
// exactly like the references (measured: the bar edge and the rising letters are 1 px sharp mid-move).
function almSharp(t) { return Math.floor(t * ALM.fps + 1e-4) / ALM.fps; }
// smoothstep, clamped. Anything that moves the WHOLE frame (camera, a slide of the whole card) uses this:
// its peak speed is 1.5x the average, where a cubic ease-in-out peaks at 3x and reads as a jump.
function smooth(x) { x = clamp(x); return x * x * (3 - 2 * x); }
// eo3 of the progress between t0 and t0+dur, clamped — the curve almost every reference move fitted
function ease3(t, t0, dur) { return eo3(clamp((t - t0) / Math.max(1e-4, dur))); }
// what is left of a move, for a damped spring released from rest: 1 at tau<=0, overshoots by ~0.6 % and
// settles by ~0.5 s. zeta 0.85 / omega 20.5 from a 2.5 em start depth is the joint fit to every rising letter
// of both references (rms 1.9 px over 45 samples; the start is below the mask, so only the landing shows).
function spring(tau, zeta, omega) {
  if (tau <= 0) return 1;
  const z = zeta == null ? 0.85 : zeta, w = omega == null ? 20.5 : omega, wd = w * Math.sqrt(1 - z * z);
  const f = Math.exp(-z * w * tau) * (Math.cos(wd * tau) + (z * w / wd) * Math.sin(wd * tau));
  return Math.abs(f) < 1e-4 ? 0 : f;
}
// a private seeded generator (mulberry32) so textures never consume the page's shared rnd() stream
function almRng(seed) {
  let a = (seed >>> 0) || 1;
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const almPx = v => (Math.round(v * 100) / 100) + 'px';
function almHex(c) { c = String(c).replace('#', ''); if (c.length === 3) c = c.split('').map(x => x + x).join(''); return [0, 2, 4].map(i => parseInt(c.substr(i, 2), 16)); }
// the ink that lands on `ink` when printed with mix-blend-mode:multiply over `paper`: per channel
// min(255, 255·ink/paper). A channel brighter than the paper cannot be
// reached. almUnder(ALM.mustard, ALM.paper) = #F1C968.
function almUnder(ink, paper) {
  const a = almHex(ink), b = almHex(paper || ALM.paper);
  return '#' + a.map((v, i) => Math.min(255, Math.round(255 * v / Math.max(1, b[i]))).toString(16).padStart(2, '0')).join('').toUpperCase();
}

/* ── grounds ──────────────────────────────────────────────────────────────────────────────────── */
// A: a clean white page — no grain, no vignette (the reference is pure #FFFFFF edge to edge).
function groundPage(color) {
  ground.style.backgroundImage = 'none';
  ground.style.background = color || ALM.page;
  vig.style.background = 'none';
  grain(0);
}
// B: charcoal #282828 with only the faintest vignette (the reference corners are the same 40 as the edges;
// the darkening you see near the card is the card's own shadow).
function groundCharcoal(color, vignette) {
  ground.style.backgroundImage = 'none';
  ground.style.background = color || ALM.charcoal;
  const v = vignette == null ? 0.06 : vignette;              // corners only: 40 -> ~38 at the extreme corner
  vig.style.background = v ? `radial-gradient(ellipse at 50% 50%,rgba(0,0,0,0) 75%,rgba(0,0,0,${v}) 100%)` : 'none';
  grain(0);
}

/* ── the camera ───────────────────────────────────────────────────────────────────────────────── */
// a full-frame wrapper every scene builds into, so the whole picture can breathe in at the end
function almCam(parent) {
  const c = document.createElement('div'); c.className = 'alm-cam';
  (parent || scene).appendChild(c); return c;
}
// the slow push-in both references do once everything has landed: ~1 % over the hold (smoothstep).
// ox/oy set the origin (B's push is centred near (1300, 550): its left edge travels 12 px, its right 5 px).
function breathe(el, t, t0, t1, amount, ox, oy) {
  const s = 1 + (amount == null ? 0.01 : amount) * smooth((t - t0) / Math.max(1e-3, t1 - t0));
  if (ox != null) el.style.transformOrigin = `${ox}px ${oy}px`;
  el.style.transform = s === 1 ? 'none' : `scale(${s.toFixed(5)})`;
}

/* ── paper texture ────────────────────────────────────────────────────────────────────────────── */
// The card in B is printed matter. Measured on the reference (levels of 255):
//   black interior  std 0.9–1.5, p99.9 +13..+19, bright (>+20) pixels 0.01–0.09 %: faint dust, faint veins
//   mustard         white cracks at +20..+40
//   paper           std 2.5, 17 % of pixels ≥3 levels darker, 1.2 % ≥8 darker: a fine fibre grain
// That is not one white layer (white-over adds 241·a on black but only 13·a on paper). Three canvases, drawn
// ONCE in build with a seed:
//   dark   multiply  — soft mottling, fibre specks, short fibres and the fine paper grain (paper and mustard only)
//   light  normal    — white veins, crackle, scratches, a speckle cluster, dust; opacity .25 (the black inks)
//   sheen  overlay   — the same veins again: overlay adds ~65·a on mustard and ~14·a on black
// paperTexture(el, seed, {w,h,veins,creases,light,dark,grain,grainRect,veinsOnInk,dust}) appends all three to el.
//   grain      paper-grain strength (1 = subtle, whole card; B's paper band measures 2.2)
//   grainRect  [x, y, w, h] in el's coords: the grain only there. B's grain is a property of the PAPER band: its
//              mustard measures std 1.0 and its black 0.9-1.5, so card.js confines the grain to the paper band.
//   veinsOnInk opacity of the normal-blend vein layer (default .25: B's black interior p99.9 is +13..+19 levels)
// paperTexture(canvas, seed) draws only the vein layer straight into that canvas (full strength).
function paperTexture(target, seed, o) {
  o = o || {};
  const r = almRng(seed == null ? 11 : seed);
  const isCanvas = target instanceof HTMLCanvasElement;
  const w = Math.round(o.w || (isCanvas ? target.width : target.offsetWidth) || W);
  const h = Math.round(o.h || (isCanvas ? target.height : target.offsetHeight) || H);
  const mk = () => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const light = isCanvas ? target : mk(), dark = isCanvas ? null : mk();
  const L = light.getContext('2d'), kL = o.light == null ? 1 : o.light;
  L.lineCap = 'round'; L.lineJoin = 'round';

  // a vein: a jagged walk that keeps a heading, stroked segment by segment with varying weight and alpha,
  // throwing off shorter, thinner branches
  function vein(x, y, head, len, lw, a, depth) {
    let ang = head, run = 0; const pts = [[x, y]];
    while (run < len) {
      const step = 3 + r() * 6;
      ang += (r() - 0.5) * 0.75; ang = ang * 0.8 + head * 0.2;          // jitter, pulled back to the heading
      x += Math.cos(ang) * step; y += Math.sin(ang) * step; run += step; pts.push([x, y]);
      if (depth < 2 && r() < 0.022) {
        const side = r() < 0.5 ? -1 : 1;
        vein(x, y, ang + side * (0.45 + r() * 0.8), len * (0.12 + r() * 0.3), lw * 0.65, a * 0.85, depth + 1);
      }
      if (x < -50 || y < -50 || x > w + 50 || y > h + 50) break;
    }
    L.strokeStyle = '#fff';
    for (let i = 1; i < pts.length; i++) {
      const k = Math.max(0, Math.sin(i * 0.23 + r() * 0.9) * 1.3 - 0.15);   // the vein breaks up: gaps, not a wire
      if (k <= 0.02) continue;
      L.globalAlpha = Math.min(1, a * Math.min(1, k) * kL); L.lineWidth = lw * (0.55 + 0.9 * r());
      L.beginPath(); L.moveTo(pts[i - 1][0], pts[i - 1][1]); L.lineTo(pts[i][0], pts[i][1]); L.stroke();
      if (r() < 0.06) {                                                  // a hair-crack off the side
        const ca = Math.atan2(pts[i][1] - pts[i - 1][1], pts[i][0] - pts[i - 1][0]) + (r() < .5 ? -1 : 1) * (0.8 + r());
        const cl = 4 + r() * 16; L.globalAlpha *= 0.7; L.lineWidth *= 0.6;
        L.beginPath(); L.moveTo(pts[i][0], pts[i][1]); L.lineTo(pts[i][0] + Math.cos(ca) * cl, pts[i][1] + Math.sin(ca) * cl); L.stroke();
      }
    }
  }
  // long veins crossing the card, mostly from the left edge heading right with a slight rise or fall
  const nv = o.veins == null ? 4 : o.veins;
  for (let i = 0; i < nv; i++) {
    const fromLeft = r() < 0.7;
    const x = fromLeft ? -10 : w * (0.1 + r() * 0.8), y = fromLeft ? h * (0.08 + r() * 0.55) : -10;
    const head = fromLeft ? (-0.35 + r() * 0.7) : (0.9 + r() * 0.9);
    vein(x, y, head, w * (0.4 + r() * 0.55), 1.3 + r() * 0.9, 0.2 + r() * 0.1, 0);
  }
  // a tight crackle patch in one corner (the reference has one at the top left of the card)
  for (let i = 0; i < 5; i++) vein(r() * w * 0.12, h * (0.1 + r() * 0.35), -1.2 + r() * 2.4, 60 + r() * 140, 0.8, 0.14, 1);
  // scratches: short, nearly straight, very thin
  for (let i = 0; i < 5; i++) {
    const x = r() * w, y = r() * h, a = r() * Math.PI, l = 12 + r() * 50;
    L.globalAlpha = (0.18 + r() * 0.3) * kL; L.lineWidth = 0.7 + r() * 0.9; L.strokeStyle = '#fff';
    L.beginPath(); L.moveTo(x, y); L.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + (r() - .5) * 4, y + Math.sin(a) * l * 0.5 + (r() - .5) * 4, x + Math.cos(a) * l, y + Math.sin(a) * l); L.stroke();
  }
  // a speckle cluster (dust) and a few loose flecks
  const sx = w * (0.55 + r() * 0.35), sy = h * (0.15 + r() * 0.3);
  L.fillStyle = '#fff';
  for (let i = 0; i < 90; i++) {
    const rr = Math.pow(r(), 1.6) * 110, an = r() * 6.283;
    L.globalAlpha = (0.12 + r() * 0.35) * kL; L.beginPath(); L.arc(sx + Math.cos(an) * rr * 1.6, sy + Math.sin(an) * rr * 0.6, 0.5 + r() * 0.9, 0, 6.283); L.fill();
  }
  for (let i = 0; i < 40; i++) { L.globalAlpha = (0.1 + r() * 0.3) * kL; L.beginPath(); L.arc(r() * w, r() * h, 0.6 + r() * 1.1, 0, 6.283); L.fill(); }
  // creases: a long straight fold, a light line with a dark twin one pixel below
  const nc = o.creases == null ? 1 : o.creases;
  for (let i = 0; i < nc; i++) {
    const y0 = h * (0.2 + r() * 0.6), y1 = y0 + (r() - 0.5) * h * 0.3;
    L.globalAlpha = 0.07 * kL; L.lineWidth = 1.2; L.strokeStyle = '#fff';
    L.beginPath(); L.moveTo(0, y0); L.lineTo(w, y1); L.stroke();
    L.globalAlpha = 0.05 * kL; L.strokeStyle = '#000';
    L.beginPath(); L.moveTo(0, y0 + 1.4); L.lineTo(w, y1 + 1.4); L.stroke();
  }
  L.globalAlpha = 1;
  if (isCanvas) return { light, dark: null, sheen: null };

  // the sheen: the veins alone, before the dust goes in (overlay lifts them on mustard, barely on black)
  const sheen = mk(); sheen.getContext('2d').drawImage(light, 0, 0);
  // dust over everything: dense, tiny, faint (on black: +4..+12 levels once the layer's .25 opacity applies)
  const kDust = o.dust == null ? 1 : o.dust;
  for (let i = 0; i < Math.round(w * h / 300 * kDust); i++) {
    L.globalAlpha = (0.06 + r() * 0.14) * kL; L.beginPath(); L.arc(r() * w, r() * h, 0.4 + r() * 0.6, 0, 6.283); L.fill();
  }
  L.globalAlpha = 1;

  const Dk = dark.getContext('2d'), kD = o.dark == null ? 1 : o.dark;
  Dk.fillStyle = '#fff'; Dk.fillRect(0, 0, w, h);                      // white = no change under multiply
  // the paper grain: half-resolution noise, scaled up (2–3 px fibres), |N|·2.2·grain levels plus 1.2 % darker
  // specks. (Bilinear upscaling and the H.264 encode each take about half of it off again, so grain 2.2 lands on
  // B's measured paper: std 2.5, 17 % of pixels ≥ 3 levels darker.)
  const kG = o.grain == null ? 1 : o.grain, gr = o.grainRect || [0, 0, w, h];
  if (kG > 0 && gr[2] > 0 && gr[3] > 0) {
    const gw = Math.ceil(gr[2] / 2), gh = Math.ceil(gr[3] / 2), gc = document.createElement('canvas'); gc.width = gw; gc.height = gh;
    const gx = gc.getContext('2d'), im = gx.createImageData(gw, gh), px = im.data;
    for (let i = 0, n = gw * gh; i < n; i++) {
      let dv = Math.abs(r() + r() + r() - 1.5) * 4.4 * kG;             // |N(0,1)|·2.2 (sum of 3 uniforms, sd .5)
      if (r() < 0.012) dv += (5 + r() * 9) * kG;
      px[i * 4] = 255 - dv; px[i * 4 + 1] = 255 - dv * 1.06; px[i * 4 + 2] = 255 - dv * 1.15; px[i * 4 + 3] = 255;
    }
    gx.putImageData(im, 0, 0);
    Dk.imageSmoothingEnabled = true; Dk.drawImage(gc, gr[0], gr[1], gr[2], gr[3]);
  }
  // soft mottling: big faint blotches
  for (let i = 0; i < 10; i++) {
    const x = r() * w, y = r() * h, rad = 120 + r() * 260;
    const g = Dk.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, `rgba(120,105,90,${(0.018 + r() * 0.018) * kD})`); g.addColorStop(1, 'rgba(120,105,90,0)');
    Dk.fillStyle = g; Dk.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  // fibre specks
  for (let i = 0; i < Math.round(w * h / 420); i++) {
    Dk.globalAlpha = (0.03 + r() * 0.09) * kD; Dk.fillStyle = r() < 0.5 ? '#6d6259' : '#8d8378';
    const s = 0.6 + r() * 1.3; Dk.fillRect(r() * w, r() * h, s, s);
  }
  // short fibres
  Dk.lineCap = 'round';
  for (let i = 0; i < Math.round(w * h / 9000); i++) {
    const x = r() * w, y = r() * h, a = r() * 6.283, l = 3 + r() * 9;
    Dk.globalAlpha = (0.05 + r() * 0.1) * kD; Dk.strokeStyle = '#7a6f64'; Dk.lineWidth = 0.6 + r() * 0.5;
    Dk.beginPath(); Dk.moveTo(x, y); Dk.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); Dk.stroke();
  }
  Dk.globalAlpha = 1;
  for (const [c, blend, op] of [[dark, 'multiply', 1], [light, 'normal', o.veinsOnInk == null ? 0.25 : o.veinsOnInk], [sheen, 'overlay', 1]]) {
    c.className = 'alm-tex'; c.style.width = w + 'px'; c.style.height = h + 'px';
    if (blend !== 'normal') c.style.mixBlendMode = blend;
    if (op !== 1) c.style.opacity = op;
    target.appendChild(c);
  }
  return { light, dark, sheen };
}

/* ── the card ─────────────────────────────────────────────────────────────────────────────────── */
// B's card, measured at t=1.3 s: outer box x 134–1786, y 86–994 (1652 x 908, centred), outer radius ~50,
// a solid black border 11 px on the straight edges that THICKENS at the corners: the inner panel's radius is ~64
// (the 100-level contour crosses the corner diagonal 34 px in, which a 39 px inner radius puts at 26 px). Then a
// black inner shadow whose 50 % point sits 6 px inside the ink and fades over ~8 px (blur 6, spread 6); a faint
// pale rim on the LOWER half of the outer edge only (lit from below); a soft shadow on the ground, deeper below
// the card (40 -> 23 right under it, back to 40 some 56 px down) than above (40 -> 37). Returns handles; put
// bands / type in .inner (clipped to the inner rounded rectangle, iw x ih) and call cardFrame for the pop-in.
// o.ri sets the inner radius (default 1.28·r, the reference's ratio).
function makeCard(o) {
  o = o || {};
  const x = o.x == null ? 134 : o.x, y = o.y == null ? 86 : o.y, w = o.w || 1652, h = o.h || 908;
  const r = o.r == null ? 50 : o.r, b = o.border == null ? 11 : o.border, sh = o.shade == null ? 6 : o.shade;
  const ri = o.ri == null ? Math.round(r * 1.28) : o.ri;
  const el = document.createElement('div'); el.className = 'alm-card';
  el.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px;border-radius:${r}px;` +
    `box-shadow:inset 0 -1.2px 0 rgba(255,255,255,.085),inset 0 0 0 1px rgba(255,255,255,.025),0 10px 44px 2px rgba(0,0,0,.45);transform-origin:50% 50%`;
  const inner = document.createElement('div'); inner.className = 'alm-in';
  inner.style.cssText = `left:${b}px;top:${b}px;width:${w - 2 * b}px;height:${h - 2 * b}px;border-radius:${Math.max(0, ri)}px;background:${o.fill || ALM.cardInk}`;
  const shade = document.createElement('div'); shade.className = 'alm-shade';
  shade.style.cssText = `border-radius:${Math.max(0, ri)}px;box-shadow:inset 0 0 ${sh}px ${sh}px #000`;
  // the seal: a 3 px black ring from 2 px outside to 1 px inside the inner edge, a sibling AFTER the inner so the
  // rounded clip does not cut it. The clip's anti-aliased corner pixels were masked once per composited layer (the
  // cut-out is will-change), so content under the shade's own masked edge showed through as a pale dashed arc inside
  // the bezel (hand critique D3; cardwall's ring does the same job). The seal covers them with opaque black; the
  // shade is ~97 % black that close to the edge anyway, so nothing else changes.
  const seal = document.createElement('div'); seal.className = 'alm-fill';
  seal.style.cssText = `left:${b - 2}px;top:${b - 2}px;width:${w - 2 * b + 4}px;height:${h - 2 * b + 4}px;border:3px solid #000;` +
    `border-radius:${Math.max(0, ri) + 2}px;box-sizing:border-box;pointer-events:none`;
  el.appendChild(inner); el.appendChild(seal); (o.parent || scene).appendChild(el);
  // the texture and the inner shade are added last by cardFinish(), above whatever the scene puts inside
  return { el, inner, shade, seal, x, y, w, h, r, ri, b, ix: x + b, iy: y + b, iw: w - 2 * b, ih: h - 2 * b, seed: o.seed };
}
// call after the bands and type are in: the paper texture over every ink, then the inner shadow on top
function cardFinish(C, o) {
  o = o || {};
  if (o.texture !== false) C.tex = paperTexture(C.inner, o.seed == null ? (S.seed || 7) * 31 + 5 : o.seed, Object.assign({ w: C.iw, h: C.ih }, o));
  C.inner.appendChild(C.shade);
  return C;
}
// the pop-in: 0 -> 0.21 s opacity (eo3), scale 0.926 -> 1 (eo3 over 0.15 s) — fitted on B frames 2–6 at whole
// frames (s .966 / .987 / .998 at 1, 2, 3 frames; the earlier 0.2 s fit was read off shutter-averaged renders)
function cardFrame(C, t, t0) {
  const u = t - (t0 || 0);
  C.el.style.opacity = eo3(clamp(u / 0.21));
  const s = 1 - 0.074 * (1 - eo3(clamp(u / 0.15)));
  C.el.style.transform = s >= 1 ? 'none' : `scale(${s.toFixed(5)})`;
}
// a flat band of ink inside a parent (the card's inner, or the scene)
function almFill(parent, x, y, w, h, color) {
  const d = document.createElement('div'); d.className = 'alm-fill';
  d.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px;background:${color}`;
  parent.appendChild(d); return d;
}

/* ── band wipe ────────────────────────────────────────────────────────────────────────────────── */
// A band GROWS from one of its edges: 'down' from its top edge, 'up' from its bottom edge, 'right' from its
// left edge, 'left' from its right edge. p is 0..1, already eased by the caller. It is a clip, so anything
// inside the band (B's title) is masked by the band's moving edge — that is the reference's mask line.
// Reference curves (all eo3): A's bar 'left' t 0.40→0.83; B's mustard 'down' 0.138→0.638; B's stripe
// 'right' 0.533→0.866; B's paper 'up' 0.672→1.172.
function bandWipe(el, p, dir) {
  p = clamp(p);
  if (p >= 1) { el.style.clipPath = 'none'; el.style.visibility = 'visible'; return; }
  if (p <= 0) { el.style.visibility = 'hidden'; return; }
  el.style.visibility = 'visible';
  const q = ((1 - p) * 100).toFixed(4) + '%';
  el.style.clipPath = dir === 'down' ? `inset(0 0 ${q} 0)` : dir === 'up' ? `inset(${q} 0 0 0)`
    : dir === 'right' ? `inset(0 ${q} 0 0)` : `inset(0 0 0 ${q})`;
}

/* ── type metrics ─────────────────────────────────────────────────────────────────────────────── */
// px from the top of a line-height:size box to the alphabetic baseline (measured in the DOM, cached)
function almBaseline(size, weight, family) {
  const key = size + '|' + weight + '|' + (family || '');
  if (ALM._bl[key] != null) return ALM._bl[key];
  const d = document.createElement('div');
  d.style.cssText = `position:absolute;left:0;top:0;visibility:hidden;font-weight:${weight};font-size:${size}px;font-family:${family || ALM.font};line-height:${size}px;white-space:nowrap`;
  d.innerHTML = 'Hg<span style="display:inline-block;width:1px;height:0;vertical-align:baseline"></span>';
  scene.appendChild(d);
  const b = d.lastChild.getBoundingClientRect().top - d.getBoundingClientRect().top;
  scene.removeChild(d);
  return (ALM._bl[key] = b);
}
// ink metrics of a string in the kit face: left bearing of the first glyph, cap height (canvas measureText)
function almInk(text, size, weight, family) {
  const c = almInk.c || (almInk.c = document.createElement('canvas').getContext('2d'));
  c.font = `${weight} ${size}px ${family || ALM.font}`;
  const m = c.measureText(String(text).trim().charAt(0) || 'H'), H1 = c.measureText('H');
  return { left: -m.actualBoundingBoxLeft, cap: H1.actualBoundingBoxAscent };
}

/* ── rising letters ───────────────────────────────────────────────────────────────────────────── */
// rise(parent, text, o) sets a one-line title whose letters will rise one after another out of a mask line.
//   o.x         left edge of the INK of the first letter (parent coords)      o.align 'left' | 'right' (o.x = ink right)
//   o.baseline  baseline y (parent coords)                                    o.size / o.weight / o.color / o.ls (em)
//   o.maskY     the mask line the letters rise out of (default 0.06 em under the baseline)
//   o.maxW      shrink the size until the line fits                           o.shadow  CSS text-shadow
//   o.drop      start depth in em (2.5 = the fitted value; it starts well under the mask)
//   o.ws        extra word spacing in em (B's word gap is ~0.08 em wider than Inter's narrow display space)
// Each character keeps the x the browser gave it in the normal run (kerning and tracking survive), then
// moves on its own. Spaces count in the stagger, as they did in the reference. rise() measures with
// getBoundingClientRect, so build it BEFORE any ancestor gets a transform (3D, camera, pop-in scale).
function rise(parent, text, o) {
  o = o || {};
  text = String(text == null ? '' : text);
  const fam = o.family || ALM.font, wt = o.weight || 800, ls = o.ls == null ? -0.02 : o.ls, ws = o.ws || 0;
  let size = o.size || 140;
  const probe = document.createElement('div');
  probe.style.cssText = `position:absolute;left:0;top:0;visibility:hidden;white-space:pre;font-weight:${wt};font-family:${fam};letter-spacing:${ls}em;word-spacing:${ws}em;line-height:1`;
  probe.style.fontSize = size + 'px'; probe.textContent = text; scene.appendChild(probe);
  let wid = probe.getBoundingClientRect().width;
  if (o.maxW && wid > o.maxW) {
    for (let k = 0; k < 4 && wid > o.maxW; k++) { size = Math.floor(size * o.maxW / wid * 1000) / 1000; probe.style.fontSize = size + 'px'; wid = probe.getBoundingClientRect().width; }
  }
  scene.removeChild(probe);
  const base = o.baseline, maskY = o.maskY == null ? base + size * 0.06 : o.maskY;
  const head = size * 1.25, bl = almBaseline(size, wt, fam), ink = almInk(text, size, wt, fam);
  const top = base - head, padL = size * 0.3;
  const m = document.createElement('div'); m.className = 'alm-rise';
  const line = document.createElement('div'); line.className = 'alm-rline';
  line.style.cssText = `left:${almPx(padL)};top:${almPx(head - bl)};font-weight:${wt};font-size:${size}px;font-family:${fam};` +
    `line-height:${size}px;letter-spacing:${ls}em;word-spacing:${ws}em;color:${o.color || ALM.ink}` + (o.shadow ? `;text-shadow:${o.shadow}` : '');
  line.textContent = text; m.appendChild(line); parent.appendChild(m);
  // each character's x in the normal run
  const tn = line.firstChild, rg = document.createRange(), L0 = line.getBoundingClientRect().left, xs = [];
  for (let i = 0; i < text.length; i++) { rg.setStart(tn, i); rg.setEnd(tn, i + 1); xs.push(rg.getBoundingClientRect().left - L0); }
  const runW = line.getBoundingClientRect().width;
  line.textContent = '';
  const ch = [];
  for (let i = 0; i < text.length; i++) {
    if (/\s/.test(text[i])) continue;
    const s = document.createElement('span'); s.className = 'alm-ch'; s.textContent = text[i]; s.style.left = almPx(xs[i]);
    line.appendChild(s); ch.push({ el: s, i });
  }
  // place the mask so the first letter's ink starts at o.x (or the run ends at o.x when right-aligned)
  const inkL = ink.left, trail = ls * size;                     // letter-spacing adds space after the last glyph
  const left = o.align === 'right' ? o.x - (runW - trail) : o.x - inkL;
  m.style.cssText = `left:${almPx(left - padL)};top:${almPx(top)};width:${almPx(runW + padL * 2)};height:${almPx(maskY - top)}`;
  return { mask: m, line, ch, n: text.length, size, drop: (o.drop == null ? 2.5 : o.drop) * size, width: runW - trail, left, cap: ink.cap };
}
// riseFrame(h, t, t0, rate): letter i leaves at t0 + i/rate and springs up into place.
// Fitted: A t0 0.618 s, 25 letters/s (148 px type); B t0 0.285 s, 18.9 letters/s (328 px type).
function riseFrame(h, t, t0, rate, zeta, omega) {
  const r = rate || 25;
  for (const c of h.ch) {
    const f = spring(t - t0 - c.i / r, zeta, omega);
    c.el.style.transform = f === 0 ? 'none' : `translate3d(0,${(h.drop * f).toFixed(2)}px,0)`;
  }
}
// when the last letter of a rise is still (for scene timing)
function riseEnd(h, t0, rate) { return t0 + Math.max(0, h.n - 1) / (rate || 25) + 0.5; }

// almWrap(text, size, weight, width, ls): the rows the browser wraps `text` into at `width` with
// text-wrap:balance (so a two-row statement splits evenly, not one long row and a widow)
function almWrap(text, size, weight, width, ls, family) {
  const d = document.createElement('div');
  d.style.cssText = `position:absolute;left:0;top:0;visibility:hidden;width:${width}px;font-family:${family || ALM.font};font-size:${size}px;font-weight:${weight};letter-spacing:${ls || 0}em;line-height:1;text-wrap:balance`;
  d.innerHTML = String(text || '').split(/\s+/).filter(Boolean).map(w => `<span>${esc(w)} </span>`).join('');
  scene.appendChild(d);
  const rows = []; let tp = null;
  for (const sp of d.children) { if (tp === null || Math.abs(sp.offsetTop - tp) > 4) { rows.push([]); tp = sp.offsetTop; } rows[rows.length - 1].push(sp.textContent); }
  scene.removeChild(d);
  return rows.map(r => r.join('').trim());
}
// riseLines(parent, text | rows[], o): several rows, each its own core rise(), row k rising after row k-1's
// letters. o = {x, baseline (first row), pitch, size, weight, ls, color, shadow, width (wrap width, for text),
// rate (letters/s, default 25), desc (mask depth under each baseline in em: 0.06 capitals, 0.26 lower case),
// maxW, align, family}. Returns {hs, starts, n, rate, rows}.
function riseLines(parent, text, o) {
  o = o || {};
  const size = o.size || 66, wt = o.weight || ALM.wTitle, ls = o.ls == null ? -0.03 : o.ls;
  const rows = Array.isArray(text) ? text.map(String) : almWrap(text, size, wt, o.width || 900, ls, o.family);
  const pitch = o.pitch || Math.round(size * 1.03), desc = o.desc == null ? 0.06 : o.desc, rate = o.rate || 25;
  const hs = [], starts = []; let n = 0;
  rows.forEach((row, k) => {
    const b = o.baseline + k * pitch;
    hs.push(rise(parent, row, Object.assign({}, o, { size, weight: wt, ls, baseline: b, maskY: b + size * desc })));
    starts.push(n / rate); n += row.length;
  });
  return { hs, starts, n, rate, rows };
}
function riseLinesFrame(h, t, t0) { h.hs.forEach((x, k) => riseFrame(x, t, t0 + h.starts[k], h.rate)); }
function riseLinesEnd(h, t0) { return t0 + Math.max(0, h.n - 1) / h.rate + 0.5; }

/* ── cut-out photographs ──────────────────────────────────────────────────────────────────────── */
// A cut-out arrives either as a URL string or, after almanac_prep.py, as {src, ar (w/h), face:[cx,cy,fh]
// (fractions of the image), edges ('ltrb' subset: the sides the photo was cut by its frame), edge_alpha, nat:[w,h]}.
// Always read it through these two so a scene works with both forms.
function almSrc(v) { return v == null ? '' : typeof v === 'string' ? v : (v.src || ''); }
function almCut(v) {
  const o = (v && typeof v === 'object') ? v : {};
  return { src: almSrc(v), ar: +o.ar || 0.84, face: o.face || [0.5, 0.36, 0.3], edges: o.edges || '',
    edge_alpha: o.edge_alpha || {}, nat: o.nat || null, top: +o.top || 0, known: !!(v && typeof v === 'object' && o.ar) };
}
// cutout(parent, src, o): a transparent PNG fitted (contain) into a box, with a soft drop shadow.
//   src               a URL, or the prep's {src, ar, face, edges} object
//   o.x o.y o.w o.h   the box (top-left); or o.cx o.cy for its centre       o.pos   object-position ('50% 100%' = sit on the bottom)
//   o.bw              black & white (grayscale + a touch of contrast), as A's portrait
//   o.edge            a white sticker edge in px (A shows a thin white rim where the cut-out crosses its shadow)
//   o.shadow          {x,y,blur,a} or false. A: 22,10,26,.34 on white; B: 12,10,16,.5 on paper/black
//   o.rot / o.scale   the resting rotation (deg, CSS: negative = counter-clockwise) and scale
function cutout(parent, src, o) {
  o = o || {};
  const url = almSrc(src);
  const w = o.w || 600, h = o.h || 600;
  const x = o.cx != null ? o.cx - w / 2 : (o.x || 0), y = o.cy != null ? o.cy - h / 2 : (o.y || 0);
  const d = document.createElement('div'); d.className = 'alm-cut';
  d.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px;transform-origin:${o.origin || '50% 50%'};will-change:transform,opacity`;
  const img = document.createElement('img'); img.src = url; img.decoding = 'sync';
  if (o.pos) img.style.objectPosition = o.pos;
  const f = [];
  if (o.bw) f.push('grayscale(1)', `contrast(${o.contrast || 1.06})`);
  const e = o.edge || 0;
  if (e) f.push(`drop-shadow(${e}px 0 0 #fff)`, `drop-shadow(-${e}px 0 0 #fff)`, `drop-shadow(0 ${e}px 0 #fff)`, `drop-shadow(0 -${e}px 0 #fff)`);
  const sh = o.shadow === false ? null : Object.assign({ x: 14, y: 10, blur: 18, a: 0.45 }, o.shadow || {});
  if (sh) f.push(`drop-shadow(${sh.x}px ${sh.y}px ${sh.blur}px rgba(0,0,0,${sh.a}))`);
  if (f.length) img.style.filter = f.join(' ');
  d.appendChild(img); (parent || scene).appendChild(d);
  if (!url) d.style.display = 'none';
  return { el: d, img, x, y, w, h, rot: o.rot || 0, scale: o.scale || 1, meta: almCut(src) };
}
// cutoutFrame(h, t, m): the landing. Everything is expressed as "where it starts, relative to where it rests":
//   m.t0, m.dur       the move (eased eo3 unless m.ease)          m.dx, m.dy   start offset (px)
//   m.rot0            extra start rotation (deg)                   m.s0         start scale factor
//   m.fade0, m.fade   opacity 0 -> 1 (eo3) from fade0 over fade s  m.drift {t0,t1,dx,dy,ds} a slow float after (smoothstep)
//   m.settle {t0,dur,dx,dy}  the few-px overshoot after the landing (half-sine bump)
// A's portrait: fade 0.20 +0.26, slide from dx -440 over 0.16 +0.42.  B's object: fade 0.42 +0.28,
// from (+160,+130), rot0 -15, s0 1.12 over 0.42 +0.26, settling (-4,-6) — both fitted frame by frame.
function cutoutFrame(h, t, m) {
  const p = clamp((t - m.t0) / (m.dur || 0.4));
  const e = m.ease ? m.ease(p) : eo3(p), k = 1 - e;
  const f0 = m.fade0 == null ? m.t0 : m.fade0;
  const op = m.fade === 0 ? 1 : eo3(clamp((t - f0) / (m.fade || m.dur || 0.4)));
  let x = (m.dx || 0) * k, y = (m.dy || 0) * k;
  const r = h.rot + (m.rot0 || 0) * k;
  let s = h.scale * (1 + ((m.s0 || 1) - 1) * k);
  if (m.settle) {                                     // the small overshoot after landing: a half-sine bump
    const u = clamp((t - m.settle.t0) / (m.settle.dur || 0.6)), bump = Math.sin(Math.PI * u) * (u > 0 && u < 1 ? 1 : 0);
    x += (m.settle.dx || 0) * bump; y += (m.settle.dy || 0) * bump;
  }
  if (m.drift) {
    const q = smooth((t - m.drift.t0) / Math.max(1e-3, m.drift.t1 - m.drift.t0));
    x += (m.drift.dx || 0) * q; y += (m.drift.dy || 0) * q; s *= 1 + (m.drift.ds || 0) * q;
  }
  h.el.style.transform = `translate3d(${x.toFixed(2)}px,${y.toFixed(2)}px,0) rotate(${r.toFixed(3)}deg) scale(${s.toFixed(5)})`;
  h.el.style.opacity = op.toFixed(4);
}
// almLift(el, p, o): a photo peeling up off the page, p 0..1 (already eased by the caller).
//   o.shadow {x,y,blur,a}  the shadow it casts at p = 1 (default 18, 24, 30, .34)    o.scale  (default 1.03)
//   o.dx, o.dy             nudge at p = 1 (default -8, 0)                           o.rot    extra rotation (deg)
//   o.origin               transform origin (default '50% 100%': it lifts from its foot)
//   o.base                 filter(s) to keep in front of the shadow (e.g. 'grayscale(1)')
//   o.baseTransform        transform to keep in front of the lift (e.g. the element's resting translate)
// Sets el.style.filter and el.style.transform; at p = 0 both are just the bases.
function almLift(el, p, o) {
  o = o || {}; p = clamp(p);
  const sh = Object.assign({ x: 18, y: 24, blur: 30, a: 0.34 }, o.shadow || {});
  const s = 1 + ((o.scale == null ? 1.03 : o.scale) - 1) * p, dx = (o.dx == null ? -8 : o.dx) * p, dy = (o.dy || 0) * p, rot = (o.rot || 0) * p;
  el.style.transformOrigin = o.origin || '50% 100%';
  const f = (o.base ? o.base + ' ' : '') + (p > 0 ? `drop-shadow(${(sh.x * p).toFixed(2)}px ${(sh.y * p).toFixed(2)}px ${(sh.blur * p).toFixed(2)}px rgba(0,0,0,${(sh.a * p).toFixed(4)}))` : '');
  el.style.filter = f.trim() || 'none';
  el.style.transform = `${o.baseTransform ? o.baseTransform + ' ' : ''}translate3d(${dx.toFixed(2)}px,${dy.toFixed(2)}px,0) rotate(${rot.toFixed(3)}deg) scale(${s.toFixed(5)})`;
}

/* ── lines that fade in ───────────────────────────────────────────────────────────────────────── */
// fadeLines(parent, text, o) sets a paragraph broken into its rendered lines.
//   o.x, o.baseline (first line's baseline) or o.y (top), o.w (wrap width), o.size, o.weight, o.lh (line pitch px),
//   o.color, o.ls (em), o.align, o.shadow (text-shadow; B's engraved look = ALM_ENGRAVE)
function fadeLines(parent, text, o) {
  o = o || {};
  const fam = o.family || ALM.font, size = o.size || 37, wt = o.weight || 600, lh = o.lh || Math.round(size * 1.74);
  const d = document.createElement('div'); d.className = 'alm-lines';
  const top = o.baseline != null ? o.baseline - (almBaseline(size, wt, fam) + (lh - size) / 2) : (o.y || 0);
  d.style.cssText = `left:${o.x || 0}px;top:${almPx(top)};width:${o.w || 800}px;font-weight:${wt};font-size:${size}px;font-family:${fam};` +
    `line-height:${lh}px;letter-spacing:${o.ls == null ? 0 : o.ls}em;color:${o.color || ALM.sub};text-align:${o.align || 'left'}` +
    (o.shadow ? `;text-shadow:${o.shadow}` : '');
  (parent || scene).appendChild(d);
  // a '\n' in the text forces a break; otherwise the browser wraps at o.w and we read the rows back
  const rows = [];
  for (const para of String(text || '').split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) continue;
    d.innerHTML = words.map(w => `<span class="alm-w">${esc(w)} </span>`).join('');
    let tp = null;
    for (const sp of d.querySelectorAll('.alm-w')) {
      if (tp === null || Math.abs(sp.offsetTop - tp) > 4) { rows.push([]); tp = sp.offsetTop; }
      rows[rows.length - 1].push(sp.textContent);
    }
  }
  d.innerHTML = rows.map(r => `<div class="alm-l">${esc(r.join('').trim())}</div>`).join('');
  return { el: d, lines: [...d.children], top, lh };
}
// line k fades 0 -> 1 from t0 + k*stagger over dur: pale grey to its final grey. pow 2 = ease-out quad.
// Fitted: B t0 0.995, stagger 0.08, dur 0.42, pow 2.  A's one-line subtitle: t0 1.08, dur 0.40, pow 3.
function fadeLinesFrame(h, t, t0, stagger, dur, pow) {
  const st = stagger == null ? 0.08 : stagger, du = dur || 0.42, pw = pow || 2;
  h.lines.forEach((l, k) => { l.style.opacity = (1 - Math.pow(1 - clamp((t - t0 - k * st) / du), pw)).toFixed(4); });
}
// B's paragraph is letterpressed into the paper: pale grey fill, a light lip under each stroke, a dark one above
const ALM_ENGRAVE = '0 -1.1px 0 rgba(60,52,44,.42),-0.9px 0 0 rgba(60,52,44,.22),0 1.7px 0 #fff,0.8px 0.8px 0 rgba(255,255,255,.8)';

/* ── readiness: hold the renderer until images are decoded / prep has run ─────────────────────── */
// kits.py sets window.__ready = true right after build() and renderFrame(0); Playwright then starts the frame
// loop. almHoldReady(promise) replaces __ready with a getter that stays false until EVERY promise handed to it
// has settled (and kits has written its true). A rejection is reported through window.__err, which aborts the
// render with the message; an error set anywhere (build threw) releases the hold at once so the render fails
// fast instead of timing out.
function almHoldReady(promise) {
  let H = ALM._hold;
  if (!H) {
    H = ALM._hold = { n: 0, done: 0, set: !!window.__ready };
    Object.defineProperty(window, '__ready', { configurable: true,
      get() { return !!window.__err || (H.set && H.done >= H.n); }, set(v) { H.set = !!v; } });
  }
  H.n++;
  Promise.resolve(promise).then(() => { H.done++; }, e => { window.__err = window.__err || ('almanac: ' + String(e && e.stack || e)); H.done++; });
  return promise;
}

/* ── the film grade & footage ─────────────────────────────────────────────────────────────────── */
// THE film grade of the style: mono, a little contrast, then the picture is printed in ALMANAC's inks —
// multiply by ALM.paper (whites become paper) and screen with ALM.ink (blacks become ink). Every footage scene
// uses it, so all film looks printed on the same stock. Plain footage cut between the templates gets the same
// look in ffmpeg with ALM_GRADE_FF (ink #151515 → .082, paper #F4F1F0 → .957/.945/.941).
const ALM_MONO = 'grayscale(1) contrast(1.14) brightness(1.02)';
const ALM_GRADE_FF = 'hue=s=0,eq=contrast=1.14:brightness=0.02,colorlevels=romin=0.082:gomin=0.082:bomin=0.082:romax=0.957:gomax=0.945:bomax=0.941';
const ALM_FILM_PAPER = '#F4F1F0';          // the film's white stays the MEASURED paper, so it matches ALM_GRADE_FF
function almDuotone(ctx, x, y, w, h) {
  ctx.save();
  ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = ALM_FILM_PAPER; ctx.fillRect(x, y, w, h);
  ctx.globalCompositeOperation = 'screen'; ctx.fillStyle = ALM.ink; ctx.fillRect(x, y, w, h);
  ctx.restore();
}
// almGrade(ctx, x, y, w, h, grade, o): grade the pixels already in that rect of a canvas.
//   grade  'mono' (default) | 'none' (modern colour footage: left alone)
//   o.keepAlpha  the rect has transparent pixels (a cut-out): restore its alpha afterwards
// When you are about to draw an image anyway, almFootage.draw() is cheaper: it applies ALM_MONO while drawing
// and then only the duotone, with the same result.
function almGrade(ctx, x, y, w, h, grade, o) {
  if (grade === 'none' || w <= 0 || h <= 0) return;
  o = o || {};
  const c = document.createElement('canvas'); c.width = Math.ceil(w); c.height = Math.ceil(h);
  const cx = c.getContext('2d'); cx.drawImage(ctx.canvas, x, y, w, h, 0, 0, w, h);
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(x, y, w, h); ctx.filter = ALM_MONO; ctx.drawImage(c, x, y); ctx.filter = 'none';
  almDuotone(ctx, x, y, w, h);
  if (o.keepAlpha) { ctx.globalCompositeOperation = 'destination-in'; ctx.drawImage(c, x, y); }
  ctx.restore();
}
// almFootage(fo): the ONE footage player of the style. fo = S.footage after almanac_prep.py:
//   {frames:[data URIs], cuts:[first frame of each clip], fps, clips:[{src,in,out,edge}], focus_y, grade}
// Makes the Images in build (decoding sync) and holds the renderer until every one has decoded.
// Returns {imgs, n, fps, cuts, clips,
//          clipAt(fi)          which clip frame fi came from
//          idx(t, t0)          the frame to show at time t for a clip started at t0 (holds the last one)
//          img(fi)             the Image for frame fi (clamped)
//          draw(ctx, fi, x, y, w, h, o)   cover-fit frame fi into the rect at o.focusY (default fo.focus_y ?? .5),
//                              graded with o.grade (default fo.grade ?? 'mono'); o.bright multiplies it darker
//                              (tally's bar: .8); o.veil = {color, a} lays a flat ink over it; o.alpha}
// n = 0 (no frames) draws nothing and warns once, so a scene still renders its type without film.
// EXPOSURE (opt-in, off by default): fo.levels = 'auto' measures each clip once after decoding (luma p1 / p99 of up
// to 8 frames) and, when the clip is flat (p99 − p1 < 186 of 255 levels, hazy archive), lifts it so p1 lands on the
// ink and p99 on 0.86 × paper. Per clip, clips[k].levels = [lo, hi] (0–255 luma) sets it by hand, or false skips
// it. This is exposure, not a style: it runs BEFORE ALM_MONO, so almGrade stays the one grade. F.levels[k] holds
// {lo, hi} (0–1) or null; draw(…, {levels: null}) turns it off for one draw. The plain-footage twin of clip k
// (put it in front of ALM_GRADE_FF) is almLevelsFF(F.levels[k]).
const ALM_EXPO = { ink: 0.0614, white: 0.7887 };   // pre-grade values that ALM_MONO + the duotone print as ink / .86 paper
function almLevelsMap(lv) {                          // v → a·v + b, lo → ink, hi → white
  const a = (ALM_EXPO.white - ALM_EXPO.ink) / Math.max(1e-3, lv.hi - lv.lo);
  return { a, b: ALM_EXPO.ink - a * lv.lo };
}
function almLevelsCss(lv) {                          // the same map as CSS: contrast(c) then brightness(k)
  if (!lv) return '';
  const m = almLevelsMap(lv), k = m.a + 2 * m.b;
  return k > 0.05 ? `contrast(${(m.a / k).toFixed(4)}) brightness(${k.toFixed(4)})` : '';
}
function almLevelsFF(lv) {                           // ffmpeg: colorlevels maps [L, Hh] → [0, 1], the same line
  if (!lv) return '';
  const m = almLevelsMap(lv), L = (-m.b / m.a).toFixed(4), Hh = ((1 - m.b) / m.a).toFixed(4);
  return `colorlevels=rimin=${L}:gimin=${L}:bimin=${L}:rimax=${Hh}:gimax=${Hh}:bimax=${Hh}`;
}
function almExposure(F, mode) {
  const c = document.createElement('canvas'); c.width = 192; c.height = 108;
  const cx = c.getContext('2d', { willReadFrequently: true });
  F.levels = F.cuts.map((c0, k) => {
    const set = F.clips[k] && F.clips[k].levels;
    if (set === false || (mode !== 'auto' && !Array.isArray(set))) return null;
    let lo, hi;
    if (Array.isArray(set)) { lo = set[0] / 255; hi = set[1] / 255; }
    else {
      const c1 = k + 1 < F.cuts.length ? F.cuts[k + 1] : F.n, m = Math.min(8, c1 - c0), hist = new Float64Array(256);
      let tot = 0;
      for (let j = 0; j < m; j++) {
        const im = F.imgs[c0 + Math.floor((j + 0.5) * (c1 - c0) / m)];
        if (!im || !im.naturalWidth) continue;
        cx.drawImage(im, 0, 0, 192, 108);
        const d = cx.getImageData(0, 0, 192, 108).data;
        for (let i = 0; i < d.length; i += 4) { hist[Math.round(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2])]++; tot++; }
      }
      if (!tot) return null;
      const pct = q => { let s = 0; for (let v = 0; v < 256; v++) { s += hist[v]; if (s >= q * tot) return v; } return 255; };
      lo = pct(0.01) / 255; hi = pct(0.99) / 255;
    }
    const lv = { lo, hi };
    return (hi > lo && almLevelsMap(lv).a > 1.02) || Array.isArray(set) ? lv : null;
  });
}
function almFootage(fo) {
  fo = fo || {};
  const list = Array.isArray(fo) ? fo : (fo.frames || []);
  const imgs = list.map(src => { const i = new Image(); i.decoding = 'sync'; i.src = almSrc(src); return i; });
  const lvMode = Array.isArray(fo) ? false : fo.levels;
  if (imgs.length) {
    const dec = Promise.all(imgs.map(i => i.decode().catch(() => null)));
    const wants = lvMode === 'auto' || (fo.clips || []).some(c => c && Array.isArray(c.levels));
    almHoldReady(wants ? dec.then(() => almExposure(F, lvMode)) : dec);
  }
  else console.warn('almanac: footage has no frames (was almanac_prep run?)');
  const n = imgs.length, fps = +fo.fps || 15, cuts = (fo.cuts && fo.cuts.length) ? fo.cuts.slice() : [0];
  const F = {
    imgs, n, fps, cuts, clips: fo.clips || [], levels: cuts.map(() => null),
    clipAt(fi) { let k = 0; for (let j = 0; j < cuts.length; j++) if (fi >= cuts[j]) k = j; return k; },
    idx(t, t0) { return n ? clamp(Math.floor((t - (t0 || 0)) * fps + 1e-4), 0, n - 1) : 0; },
    img(fi) { return n ? imgs[clamp(Math.floor(fi), 0, n - 1)] : null; },
    draw(ctx, fi, x, y, w, h, o) {
      o = o || {};
      const im = F.img(fi); if (!im || !im.naturalWidth || w <= 0 || h <= 0) return false;
      const fy = o.focusY != null ? o.focusY : (fo.focus_y != null ? fo.focus_y : 0.5), fx = o.focusX != null ? o.focusX : 0.5;
      const grade = o.grade || fo.grade || 'mono';
      const iw = im.naturalWidth, ih = im.naturalHeight, s = Math.max(w / iw, h / ih), sw = w / s, sh = h / s;
      ctx.save();
      ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
      if (o.alpha != null) ctx.globalAlpha = o.alpha;
      const flt = [almLevelsCss(o.levels !== undefined ? o.levels : F.levels[F.clipAt(fi)]), grade !== 'none' ? ALM_MONO : ''].filter(Boolean).join(' ');
      if (flt) ctx.filter = flt;
      ctx.drawImage(im, (iw - sw) * fx, (ih - sh) * fy, sw, sh, x, y, w, h);
      ctx.filter = 'none'; ctx.globalAlpha = 1;
      if (grade !== 'none') almDuotone(ctx, x, y, w, h);
      if (o.bright != null && o.bright < 1) { const v = Math.round(255 * o.bright); ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = `rgb(${v},${v},${v})`; ctx.fillRect(x, y, w, h); }
      if (o.veil) { ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = o.veil.a == null ? 0.5 : o.veil.a; ctx.fillStyle = o.veil.color || ALM.bar; ctx.fillRect(x, y, w, h); }
      ctx.restore();
      return true;
    },
  };
  return F;
}

/* ── numbers: drum, odometer carry, jolt, stamp ───────────────────────────────────────────────── */
// almDrum(host, o): one cash-register drum column — a window showing one numeral, with the numerals printed on
// a drum that turns UP (the next numeral rises out of the window's bottom edge, the reference's mask line).
//   o.x, o.y        window top-left (host coords)         o.F   the numeral size (px)      o.w  window width
//   o.ink           numeral colour (ALM.ink)              o.under  keyline colour (text-shadow .018em .012em), or none
//   o.blank         leading wheel: show nothing for idx <= 0 (so 0,000,123 reads 123)
//   o.weight        default 900 (figures are the one place ALMANAC keeps Black)   o.ls  default -0.03 em
// Window height winH = 1.0875·F, the numeral's line box (line-height F) sits 0.0435·F inside it, so the baseline
// is at y + 0.9075·F and one numeral pitch equals winH. A per-drum SVG feGaussianBlur (0 σ) blurs the STRIP,
// never the window, so nothing smears above the mask.
// Returns {el, strip, faces, winH, F, set(pos, speed, kick)}:
//   pos    the wheel position (numeral value, fractional while turning; floor(pos) mod 10 is shown)
//   speed  numerals per second (for the blur: σ = min(.11·winH, speed·winH/300), off below .4 px)
//   kick   extra displacement in numerals (the clunk after it stops), e.g. -0.07·sin(2π·6.5τ)·e^(−15τ)
function almDrum(host, o) {
  o = o || {};
  const F = o.F || 200, winH = 1.0875 * F, w = o.w || Math.ceil(0.62 * F) + 6, id = 'alm-db' + (++ALM._fid);
  const el = document.createElement('div'); el.className = 'alm-drum';
  el.style.cssText = `left:${o.x || 0}px;top:${o.y || 0}px;width:${w}px;height:${almPx(winH)}`;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '0'); svg.setAttribute('height', '0'); svg.style.position = 'absolute';
  svg.innerHTML = `<defs><filter id="${id}" x="-5%" y="-40%" width="110%" height="180%"><feGaussianBlur stdDeviation="0 0"/></filter></defs>`;
  const strip = document.createElement('div'); strip.className = 'alm-strip';
  const faces = [];
  for (let k = 0; k < 3; k++) {
    const d = document.createElement('div'); d.className = 'alm-num';
    d.style.cssText += `;font-weight:${o.weight || 900};font-size:${F}px;line-height:${F}px;letter-spacing:${o.ls == null ? -0.03 : o.ls}em;` +
      `font-feature-settings:'tnum' 1;color:${o.ink || o.color || ALM.ink}` + (o.under ? `;text-shadow:${(0.018 * F).toFixed(1)}px ${(0.012 * F).toFixed(1)}px 0 ${o.under}` : '');
    d.textContent = '0'; strip.appendChild(d); faces.push(d);
  }
  el.appendChild(svg); el.appendChild(strip); (host || scene).appendChild(el);
  const blur = svg.querySelector('feGaussianBlur'), base0 = 0.0435 * F, s95 = Math.sin(0.95);
  const D = { el, strip, faces, winH, F, w,
    set(pos, speed, kick) {
      const b = Math.floor(pos), fr = pos - b, kk = kick || 0;
      for (let k = 0; k < 3; k++) {
        const idx = b + k - 1, d = (k - 1) - fr + kk, n = ((idx % 10) + 10) % 10;
        const txt = (o.blank && idx <= 0) ? '' : String(n);
        if (faces[k].textContent !== txt) faces[k].textContent = txt;
        const th = clamp(d, -1.3, 1.3) * 0.95, y = base0 + Math.sin(th) / s95 * winH, sy = lerp(1, Math.cos(th), 0.55);
        faces[k].style.transform = `translate3d(0,${y.toFixed(2)}px,0) scaleY(${sy.toFixed(4)})`;
      }
      const sig = Math.min(0.11 * winH, Math.abs(speed || 0) * winH / 300);
      if (sig > 0.4) { blur.setAttribute('stdDeviation', `0 ${sig.toFixed(2)}`); strip.style.filter = `url(#${id})`; }
      else strip.style.filter = 'none';
    },
  };
  D.set(0, 0, 0);
  return D;
}
// almOdoPos(v, k): the mechanical carry. The wheel of power k (0 = units) turns only during the last unit before
// its carry, so 1,999 → 2,000 rolls three wheels together at the end, like a real counter.
function almOdoPos(v, k) {
  if (!k) return v;
  const P = Math.pow(10, k), b = Math.floor(v / P), r = v - b * P;
  return b + clamp(r - (P - 1), 0, 1);
}
// almJolt(t, times, amp, freq, decay, phase): Σ amp·s(2π·freq·τ)·e^(−decay·τ) over the kicks already started
// (τ = t − tᵢ ≥ 0). times: numbers, or {t, amp} to weight one kick. phase 'sin' (default: starts at rest, a clunk
// transmitted through the frame) or 'cos' (starts at full displacement: an impact such as the stamp).
// Tally's clunks: almJolt(t, b, 3.2, 9, 14). Register's stamp: almJolt(t, [tl], 5, 6, 16, 'cos').
function almJolt(t, times, amp, freq, decay, phase) {
  let s = 0; const f = phase === 'cos' ? Math.cos : Math.sin;
  for (const e of (times || [])) {
    const ti = typeof e === 'number' ? e : e.t, a = typeof e === 'number' ? amp : (e.amp == null ? amp : e.amp), tau = t - ti;
    if (tau >= 0) s += a * f(2 * Math.PI * freq * tau) * Math.exp(-decay * tau);
  }
  return s;
}
// almStamp(host, o): the worn rubber proof stamp. RED IS THE STAMP'S INK ONLY — it never appears as type or bars.
//   o.text (main line, Kit Sans 900 128 px, ≤ 10 characters), o.sub (800 26 px .24em), o.color (ALM.red),
//   o.rot (deg, default -7), o.x / o.y (the stamp's CENTRE in host coords), o.fitW / o.fitH (scale down so the
//   ROTATED box fits), o.seed (the wear pattern)
// Outer border 9 px (r 22), 8 px gap, inner border 3 px (r 12), padding 10/46/16. Wear: a seeded 900 × 360 mask
// (5,200 pit attempts, densest toward the lower right, plus 22 soft worn patches) as -webkit-mask-image. A ghost
// impression at 16 % sits (+6, −5) off the main one (opacity .94) — the double strike.
// Returns {el, pre, main, ghost, w, h, fit, frame(t, t0)}. The impression is never shown in flight (you would see the
// rubber block, not a print): for the 0.10 s before impact tl = t0 + .09 only the block's soft shadow shows on the
// paper (a rounded rect 1.06× the stamp, black .05 → .14, closing in under it: offset (22, 30) → 0, blur 34 → 16 px,
// scale 1.08 → 1); at impact the
// impression appears at full strength with a 2-frame ink spread (scale 1.012 → 1, opacity 1 → .94) and the ghost
// (the double strike). frame returns tl so the caller can shake the page: almJolt(t, [tl], 5, 6, 16, 'cos').
function almStamp(host, o) {
  o = o || {};
  const col = o.color || ALM.red, rng = almRng(o.seed == null ? 1931 : o.seed), mw = 900, mh = 360;
  const mc = document.createElement('canvas'); mc.width = mw; mc.height = mh; const x = mc.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, mw, mh); x.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 5200; i++) {
    const px = rng() * mw, py = rng() * mh, wear = 0.25 + 0.75 * Math.pow(px / mw, 2.2) * (py / mh);
    if (rng() > wear) continue;
    x.globalAlpha = 0.35 + rng() * 0.65; x.beginPath(); x.ellipse(px, py, 0.6 + rng() * 2.6, 0.5 + rng() * 1.8, rng() * 3, 0, 7); x.fill();
  }
  for (let i = 0; i < 22; i++) { x.globalAlpha = 0.10 + rng() * 0.25; x.beginPath(); x.ellipse(mw * (0.55 + rng() * 0.45), mh * (0.3 + rng() * 0.7), 10 + rng() * 40, 4 + rng() * 14, rng() * 3, 0, 7); x.fill(); }
  const mask = mc.toDataURL();
  const inner = `<div style="border:9px solid ${col};border-radius:22px;padding:8px"><div style="border:3px solid ${col};border-radius:12px;padding:10px 46px 16px;text-align:center;color:${col}">` +
    `<div style="font-weight:900;font-size:128px;line-height:1;letter-spacing:.01em;white-space:nowrap">${esc(o.text || '')}</div>` +
    (o.sub ? `<div style="margin-top:8px;font-weight:800;font-size:26px;line-height:1;letter-spacing:.24em;white-space:nowrap">${esc(o.sub)}</div>` : '') + `</div></div>`;
  const el = document.createElement('div'); el.className = 'alm-stamp';
  const mk = op => { const d = document.createElement('div'); d.style.cssText = `position:absolute;left:0;top:0;-webkit-mask-image:url(${mask});-webkit-mask-size:100% 100%;mask-image:url(${mask});mask-size:100% 100%;opacity:${op}`; d.innerHTML = inner; return d; };
  const ghost = mk(0.16), main = mk(0.94), pre = document.createElement('div');
  el.appendChild(pre); el.appendChild(ghost); el.appendChild(main); (host || scene).appendChild(el);
  const bw = main.offsetWidth, bh = main.offsetHeight, rot = o.rot == null ? -7 : +o.rot, ra = Math.abs(rot * Math.PI / 180);
  const rw = bw * Math.cos(ra) + bh * Math.sin(ra), rh = bw * Math.sin(ra) + bh * Math.cos(ra);
  const fit = Math.min(1, o.fitW ? o.fitW / rw : 1, o.fitH ? o.fitH / rh : 1);
  el.style.width = bw + 'px'; el.style.height = bh + 'px';
  el.style.left = ((o.x == null ? 960 : o.x) - bw / 2) + 'px'; el.style.top = ((o.y == null ? 540 : o.y) - bh / 2) + 'px';
  ghost.style.transform = 'translate(6px,-5px)';
  pre.style.cssText = `position:absolute;left:${-0.03 * bw}px;top:${-0.03 * bh}px;width:${1.06 * bw}px;height:${1.06 * bh}px;` +
    `border-radius:26px;background:#000;filter:blur(18px);opacity:0;display:none;transform-origin:50% 50%`;
  return { el, pre, main, ghost, w: bw, h: bh, fit, rot,
    frame(t, t0) {
      const tl = t0 + 0.09, p0 = tl - 0.10;
      if (t < p0) { el.style.display = 'none'; return tl; }
      el.style.display = 'block';
      if (t < tl) {                                   // the block coming down: its shadow only, closing in under it
        const a = clamp((t - p0) / 0.10), k = 1 - a;
        pre.style.display = 'block'; pre.style.opacity = (0.14 * (0.35 + 0.65 * a)).toFixed(4);
        pre.style.filter = `blur(${(16 + 18 * k).toFixed(1)}px)`;
        pre.style.transform = `translate(${(22 * k).toFixed(1)}px,${(30 * k).toFixed(1)}px) scale(${(1 + 0.08 * k).toFixed(4)})`;
        main.style.opacity = 0; ghost.style.opacity = 0;
        el.style.transform = `rotate(${rot}deg) scale(${fit.toFixed(5)})`;
        return tl;
      }
      pre.style.display = 'none';
      const u = clamp((t - tl) / (2 / 30));           // the 2-frame ink spread
      main.style.opacity = lerp(1, 0.94, u).toFixed(4); ghost.style.opacity = 0.16;
      el.style.transform = `rotate(${rot}deg) scale(${(lerp(1.012, 1, u) * fit).toFixed(5)})`;
      return tl;
    } };
}

/* ── the shutter (A's opening) ────────────────────────────────────────────────────────────────── */
// t=0 is the bare page; a dark panel fades in (opacity eo3 over 0.267 s) while it scales from 0.943 to 1
// (eo3 over 0.2 s) — the flat grey frames — and from 0.1 s it drops off the bottom of the frame
// (translateY 1080 * eo3((t - 0.1) / 0.467)), the last of it running out as a strip along the bottom edge.
// Build it LAST so it sits on top of everything; it is gone (display:none) after 0.6 s.
function shutterBuild(parent, color) {
  const d = document.createElement('div'); d.className = 'alm-shutter';
  d.style.cssText = `width:${W}px;height:${H}px;background:${color || ALM.shutter}`;
  (parent || scene).appendChild(d); ALM.shutterEl = d; return d;
}
function shutter(t, el, t0) {
  el = el || ALM.shutterEl || shutterBuild();
  const u = t - (t0 || 0);
  if (u < 0 || u >= 0.6) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  const a = eo3(clamp(u / 0.267)), s = 1 - 0.057 * (1 - eo3(clamp(u / 0.2))), y = H * eo3(clamp((u - 0.1) / 0.467));
  el.style.opacity = a.toFixed(4);
  el.style.transform = `translate3d(0,${y.toFixed(2)}px,0) scale(${s.toFixed(5)})`;
}

/* bar.js — SCENES.bar: the name bar (reference A, "Sam Giancana").
   A white page opens under a dark shutter that drops off the bottom of the frame; a black-and-white cut-out
   of the person slides in and fades up from pale; a dark bar grows from the far edge BEHIND the cut-out; the
   name, in yellow, rises letter by letter out of the bar's bottom edge; a one-line description fades in
   under the bar. Then the picture breathes in.

   S: { type:'bar', photo (cut-out PNG of the person, head and shoulders or half-length; B&W is applied; after
        almanac_prep it carries {ar, face, edges}: a photo cut by its frame hugs the outer frame edge and fades
        the cut that faces the name),
        name, sub, side ('left' = person left / text right, the reference; 'right' mirrors it),
        bw (default true),
        edge (white keyline around the cut-out in px, default 0: at 2 px it read as a sticker, and reference A
              shows no rim where the suit crosses the bar),
        sub_at (s, when the subtitle starts to fade in; default 1.08 as fitted on A. A short scene can bring it
                forward to the name's start, 0.62, so it is complete before the cut) }

   Layout, measured on the reference (absolute px): bar rows 512–628 (117 px) full width, #2B2B2B;
   name ink x 992 → 1861, baseline 620, cap 105 px (Inter 700 at 148 px, tracked -0.035 em), yellow #F8D848,
   max width 874; subtitle x 991 → 1670, baseline 679, cap 31 px (Inter 700 at 44 px), #111; cut-out box x 0–960, top 37,
   sitting on the bottom edge. The whole scene runs on almSharp(t): the reference has no motion blur.
   The page's push-in is ~0.6 % between 2 s and the end; the portrait drifts ~5 px up-left on top of it. */

SCENES.bar = {
  build() {
    groundPage();
    const right = S.side === 'right';
    const cam = almCam();
    const bar = almFill(cam, 0, 512, W, 117, ALM.bar);
    // A cut-out that was cut by its photo's frame (almanac_prep's `edges`) must not show that straight cut on the
    // page: the outer cut hugs the frame edge (the reference's shoulder runs off the left edge), and a cut on the
    // side facing the name dissolves over its last 140 px instead of ending in a hard line with a sticker edge.
    const meta = almCut(S.photo), near = right ? 'r' : 'l', far = right ? 'l' : 'r';
    const bw = 960, bh = 1063;
    // A WIDE photo (someone at a desk, a group: ar > 1.15) fitted into the box would stand only half the page tall
    // and leave the top of the white page empty. It fills the box's height instead, cropped around the face (the
    // face ~42 % in from the frame edge): the crop facing the name dissolves like a frame cut, the outer one runs
    // off the frame edge as the reference's shoulder does.
    const wide = meta.known && meta.ar > 1.15;
    const hug = wide || meta.edges.includes(near), soft = wide || meta.edges.includes(far);
    const cw = wide ? bw : meta.known ? Math.min(bw, bh * meta.ar) : bw;
    let pos = hug ? (right ? '100% 100%' : '0% 100%') : '50% 100%';
    if (wide) {
      const iw = bh * meta.ar, fx = meta.face[0] * iw, aim = (right ? 0.58 : 0.42) * bw;
      pos = `${(100 * clamp((aim - fx) / (bw - iw), 0, 1)).toFixed(2)}% 100%`;
    }
    const photo = cutout(cam, S.photo, {
      x: right ? W - bw : 0, y: 37, w: bw, h: bh, origin: '50% 100%', pos,
      bw: S.bw !== false, edge: S.edge == null ? 0 : +S.edge, shadow: { x: right ? -22 : 22, y: 10, blur: 26, a: 0.34 },
    });
    if (wide) photo.img.style.objectFit = 'cover';
    if (soft) {
      const c0 = hug ? (right ? bw - cw : 0) : (bw - cw) / 2, c1 = c0 + cw;   // the image's content, in the box
      const g = right ? `linear-gradient(to left,#000 ${almPx(bw - c0 - 140)},transparent ${almPx(bw - c0 - 2)})`
                      : `linear-gradient(to right,#000 ${almPx(c1 - 140)},transparent ${almPx(c1 - 2)})`;
      photo.img.style.webkitMaskImage = g; photo.img.style.maskImage = g;
    }
    const name = rise(cam, S.name || '', {
      x: right ? W - 992 : 992, align: right ? 'right' : 'left', baseline: 620, size: 148, weight: 700,
      ls: -0.035, color: ALM.yellow, maskY: 629, maxW: 874,
    });
    const sub = fadeLines(cam, S.sub || '', {
      x: right ? W - 991 - 874 : 991, w: 874, baseline: 679, size: 44, weight: 700, lh: 52, ls: -0.01,
      color: ALM.sub, align: right ? 'right' : 'left',
    });
    shutterBuild(scene);                                                 // on top of everything, outside the camera
    parts = { cam, bar, photo, name, sub, right };
  },
  frame(t) {
    const p = parts;
    t = almSharp(t);                                                     // whole frames, like the reference
    shutter(t);                                                          // 0 → 0.57 s
    cutoutFrame(p.photo, t, {
      t0: 0.16, dur: 0.42, dx: p.right ? 440 : -440, fade0: 0.2, fade: 0.26,
      drift: { t0: 1.4, t1: 3.8, dx: p.right ? 5 : -5, dy: -4, ds: 0.002 },
    });
    bandWipe(p.bar, ease3(t, 0.40, 0.43), p.right ? 'right' : 'left');   // grows from the text side, behind the cut-out
    riseFrame(p.name, t, 0.618, 25);                                    // 25 letters/s out of the bar's bottom edge
    fadeLinesFrame(p.sub, t, S.sub_at == null ? 1.08 : +S.sub_at, 0.08, 0.40, 3);
    breathe(p.cam, t, 1.4, D, 0.007);
  },
};

/* card.js — SCENES.card: the collector's card (reference B, "ROVER V8").
   A rounded black card pops in on charcoal; a mustard band grows down from its top; the title rises letter
   by letter out of the band's bottom edge; a colour cut-out of the object lands on top of the title (it covers
   two letters on purpose); a charcoal stripe runs in under the band; an off-white paper band grows up from the
   bottom; a short paragraph, engraved into the paper, fades in line by line. Then it breathes.

   S: { type:'card', title, photo (cut-out PNG of the object), text (paragraph; '\n' forces a break),
        rotate (the object's resting angle, deg, CSS sign: negative = counter-clockwise; default -6, as measured),
        band (band colour, default mustard #E6BE61), scale (object size factor, default 1),
        obj_x / obj_y (the object's centre, default 1159 / 545, as measured; a tall paper object can sit lower and
        further right so it covers only the foot of the title's last letters instead of whole letters) }

   Layout, measured on the reference at t = 1.3 s (absolute px): card 134–1786 x 86–994; mustard to y 485.5;
   stripe 485.5–581.5 (#262626); paper from 581.5; title ink x 248 → 1677, cap top 174, baseline 401: cap 228 px with
   47–55 px stems (stem/cap 0.22) = Inter 780 at 314 px tracked -0.046 em, words 0.08 em wider (V2 starts at
   x 1320 in the reference: its space is wider than Inter Display's), a near-white keyline offset
   (.017em, .004em) — the reference face is narrower and lighter than Inter Black, so 900 overshoots both;
   paragraph x 209, first baseline 666, 64.5 px pitch, 39 px type (the reference line "the MGB GT V8 and countless
   specials." is 711 px wide); object centre (1159, 545), fitted 672 x 650, resting at -6°.
   The whole scene runs on almSharp(t): the reference has no motion blur. */

SCENES.card = {
  build() {
    groundCharcoal();
    const cam = almCam();
    const C = makeCard({ parent: cam });
    const iw = C.iw, ih = C.ih;                           // 1630 x 886, origin (145, 97)
    // the reference's edges sit on half pixels (an anti-aliased row at 485 and at 581), which also keeps
    // H.264's 4:2:0 chroma from bleeding a pale row into the mustard: band to y 485.5, paper from 581.5
    const BAND = 485.5 - C.iy, STRIPE = 581.5 - 485.5;
    const stripe = almFill(C.inner, 0, BAND, iw, STRIPE, ALM.stripe);
    const paper = almFill(C.inner, 0, BAND + STRIPE, iw, ih - BAND - STRIPE, ALM.paperStock);  // + grain = B's paper
    const band = almFill(C.inner, 0, 0, iw, BAND, S.band || ALM.mustard);
    const title = rise(band, S.title || '', {
      x: 248 - C.ix, baseline: 401 - C.iy, size: 314, weight: ALM.wTitle, ls: -0.046, ws: 0.08, color: ALM.ink,
      maskY: BAND + 1, maxW: iw - 2 * (248 - C.ix) + 60, shadow: `.017em .004em 0 ${ALM.cream}`,
    });
    const para = fadeLines(C.inner, S.text || '', {
      x: 209 - C.ix, baseline: 666 - C.iy, w: 760, size: 39, weight: 600, lh: 64.5,
      color: ALM.engraved, shadow: ALM_ENGRAVE,
    });
    cardFinish(C, { grain: 2.2, grainRect: [0, BAND + STRIPE, iw, ih - BAND - STRIPE] });   // grain: paper band only
    const k = S.scale == null ? 1 : +S.scale;
    const obj = cutout(cam, S.photo, {
      cx: S.obj_x == null ? 1159 : +S.obj_x, cy: S.obj_y == null ? 545 : +S.obj_y,   // obj_x/obj_y: move a tall object off a key word
      w: 683 * k, h: 643 * k, rot: S.rotate == null ? -6 : +S.rotate,
      shadow: { x: 12, y: 10, blur: 16, a: 0.5 },
    });
    parts = { cam, C, band, stripe, paper, title, para, obj };
  },
  frame(t) {
    const p = parts;
    t = almSharp(t);                                                    // whole frames, like the reference
    cardFrame(p.C, t);                                                  // 0 → 0.21 s
    bandWipe(p.band, ease3(t, 0.138, 0.5), 'down');                     // mustard down to its edge
    riseFrame(p.title, t, 0.2865, 20);                                  // title out of the band's edge
    cutoutFrame(p.obj, t, { t0: 0.42, dur: 0.26, dx: 160, dy: 130, rot0: -15, s0: 1.12, fade0: 0.42, fade: 0.28,
      settle: { t0: 0.6, dur: 0.7, dx: -4, dy: -6 } });
    bandWipe(p.stripe, ease3(t, 0.533, 0.333), 'right');                // stripe runs in under the band
    bandWipe(p.paper, ease3(t, 0.670, 0.5), 'up');                      // paper up from the bottom
    fadeLinesFrame(p.para, t, 0.995, 0.08, 0.42, 2);                    // engraved lines, one by one
    breathe(p.cam, t, 1.3, D, 0.01);                                    // ~1 % push-in over the hold
  },
};

/* reel.js — SCENES.reel: the card's black stripe is a real strip of 35 mm film (ALMANAC template 1).
   B's card pops in on charcoal; the mustard band grows down and the paper band grows up; a film strip slides in
   across the card carrying unexposed cells and glides under the title as it rises out of the strip's top edge; the
   cells develop left to right, the pictures rising out of the strip's black like prints in the tray; the paragraph
   is set in the paper.
   · EVERY CELL CARRIES ITS OWN SHOT. The footage is a list of clips; each cell plays its own clip from its own point,
     so the strip is a small montage and neighbours never play in sync. The clip marked "gate": true (default: the
     last clip) is printed on the one cell that comes to rest in the gate: that is the shot the camera dives into.
     The other clips are handed out BY VISIBILITY, in the order they are listed (reel_plan): the first two rest
     beside the gate (readable ~2.5 s), the next three glide under the title (~1 s), then the cell that slides past
     into the left edge, the strip's head and the right edge; with six shots besides the gate, only cells that
     whirr past too fast to read repeat a clip (with fewer, a repeat you can read never runs in step with its twin).
     The bottom edge of every cell names its own clip.
   · ONE CONTINUOUS MOVE. The transport is a single analytic position X(t) with a continuous velocity (and a
     continuous acceleration away from the entry): the strip slides in and glides, is pulled up to speed, then coasts
     down over ~3 s and settles, without a lock or a claw, exactly on the gate cell. No frame-to-frame speed change
     above ~15 % while it is visibly moving.
   · The perforations never wagon-wheel: while the strip is fast their rows fade into the band a one-pitch smear
     makes of them (reel_perfAA).
   Then the camera DIVES into the gate cell (card, title and perforations scale with it), the film becomes the
   screen, and an index tab made of the card's three bands hangs from the top edge with the place name rising in it.

   S: { type:'reel', title (≤ 14 characters at full size), text (≤ 150 characters = 2 lines; up to 3 lines are set
        smaller, longer is cut with an ellipsis),
        footage {clips:[{src,in,out,edge?,gate?}], fps:15, width:960, crop_y, levels:'auto'|false}
                (almanac_prep adds frames + cuts; levels 'auto' (the default here) lifts flat, hazy clips to ink
                blacks and paper-ish whites per clip — core's almFootage exposure step. Give 5–8 different shots
                plus the gate shot, most important first: at D 9.6 the first two need ~3.5 s each, the next three
                ~1.7 s, the rest ~1.5–3 s, the gate clip ~7 s. A clip shorter than its cell is on screen holds its
                FIRST frame while the cell comes in fast, so it never freezes on its last one; build warns with the
                exact count, and when fewer than 4 shots are given. The two-clip form — a strip clip, then the gate
                film — still plays: the strip clip on every cell but the gate),
        edge (fallback edge legend), counter (a fixed key code at the start of the top edge row, e.g. "KD 18".
        NOT a year: it sits above the legend's own date and would read as one),
        open (default true: dive into the gate; never without film), open_at (s, when the dive starts, default
        5.1), label {name, sub} (the tab), grade 'mono' | 'none', band (the top band colour, default mustard, as
        card.js) }

   Layer stack (back to front): ground · cam (card: mustard, paper, title, paragraph, texture; gets the camera
   matrix as CSS) · the strip canvas (drawn in screen space WITH the same camera matrix, so the film stays sharp
   at 3.4x) · the tab (screen space).
   Clocks: the card, the type, the tab, the camera and the pictures inside the cells run on almSharp(t): whole
   frames, like the references (a raw-t dive at shutter 3 stacks three zoom contours of the title). Only the strip's
   position X(t) reads the raw t, and the strip carries its own exposure blur (reel_strip): a box smear over the
   distance it travels in this sub-frame's slice of the shutter, so it smears only while it is fast, and a zoom
   blur centred on the frame time for the dive, so its perforations never strobe or ghost. */

// ── constants (1920 x 1080; world = screen at zoom 1) ────────────────────────────────────────────────────
function reel_geom() {
  const R = {
    Y0: 380, SH: 440, IY: 442, CH: 316,            // strip y 380–820, image area y 442–758
    CW: 562, GAP: 30, P: 592, GX: 679,             // cell 562 + frame line 30 = pitch 592; the gate cell's left edge
    iLead: -2,                                      // the strip's cut end sits before cell -2
    PERF: 74, PW: 24, PH: 30, PR: 5, PX: 16, PT: 389, PB: 781,
    BODY: '#151515', RAW: '#151515',               // = ALM.ink: undeveloped cells melt into the black strip
    MB: 320,                                        // the widest exposure smear (px)
    DIVE: 1.0,                                      // the dive (s): peak zoom ≈ 6.4 %/frame
  };
  R.Z1 = Math.max(W / R.CW, H / R.CH) * 1.006;     // the gate cell fills the frame
  return R;
}

// ── the transport: ONE analytic position ─────────────────────────────────────────────────────────────────
// X(t) = XL + E(t) + S(t): the strip's offset (px, negative = moved left; cell i's left edge is GX + X + i·P).
//   XL = −g·P: at rest, cell g sits exactly in the gate.
//   E(t) = Ae·exp(−(t − t0)/te): the slide-in. It enters from off the right edge at t0 and glides; its speed falls
//        by a constant 1 − e^(−1/(30·te)) = 13.8 % per frame (te 0.225 s), about the gentlest landing that still
//        puts the strip under the title's first letters by 0.48 s.
//   S(t) = what is left of the spin, vs·∫ᵗ^∞ s(τ)dτ, for a speed pulse s:
//        rise  s = sech²((t − Tp)/w1)                       (t < Tp; its tail is already under way while the
//                                                             slide-in glides, so the strip never stops between)
//        coast s = [sech²(τ/w2) − f(T) − |f′(T)|·(T − τ)] / g0,  τ = t − Tp ∈ [0, T], T = Tr − Tp
//        i.e. the sech² tail minus its own tangent at Tr: an exponential coast (−8.5 %/frame at w2 0.75) that
//        reaches zero speed AND zero deceleration exactly at Tr (a soft landing, no lock), g0 = 1 − f(T) − |f′(T)|·T
//        keeps the speed continuous at the peak. Both halves integrate in closed form (tanh), so X is exact.
//   vs is solved so that the strip travels exactly g pitches after the slide-in's own rest point Xm.
// Speeds (D 9.6, dive 5.1): ~390 px/frame entering → 12 px/frame at 1.13 s (the glide under the finishing title)
// → 208 px/frame at Tp 2.1 s (the whirr) → 64 at 3.0 s → 18 at 3.5 s → 7.7 at 3.8 s → 1 at 4.4 s → rest at Tr
// 5.08 s: the gate cell is still (< 1 px/frame) for the last ~0.65 s before the dive. Relative change per frame
// ≤ 13.8 % while the strip moves faster than 1 px/frame (entry 13.8, rise ≤ 13.2, coast ≤ 12.9); te 0.225 and w1 0.40
// sit at the 15 % limit, a smaller w2 would coast down faster, a larger one lands harder. An earlier dive compresses
// the spin in time with the same shape and peak: the strip falls under 1 px/frame at Tp + 0.77·(Tr − Tp) for every
// Tr (kits.py sound_marks puts its sounds on Tp and on that settle from these same constants).
function reel_transport(R, Tr) {
  const T = { t0: 0.19, te: 0.225, Xs: 2650, Xm: 0 };
  // the spin scales with the time it has (the full shape at Tr 5.08; shorter dives compress it)
  const s = clamp((Tr - 1.1) / 3.98, 0.5, 1);
  T.Tr = Tr; T.Tp = 1.1 + 1.0 * s; T.w1 = 0.40 * s; T.w2 = 0.75 * s;
  T.g = Math.max(5, Math.round(12 * s));
  T.T = T.Tr - T.Tp;
  const sech2 = x => { const c = Math.cosh(x); return 1 / (c * c); };
  T.thT = Math.tanh(T.T / T.w2); T.fT = sech2(T.T / T.w2); T.dfT = 2 / T.w2 * T.thT * T.fT;
  T.g0 = 1 - T.fT - T.dfT * T.T;
  T.Rp = (T.w2 * T.thT - T.fT * T.T - T.dfT * T.T * T.T / 2) / T.g0;   // coast distance per unit speed
  T.XL = -T.g * R.P;
  T.vs = (T.g * R.P + T.Xm) / (T.w1 + T.Rp);                           // px/s at the peak
  T.Ae = T.Xs - T.Xm;
  return T;
}
function reel_X(T, t) {
  if (t >= T.Tr) return T.XL;
  const E = T.Ae * Math.exp(-(t - T.t0) / T.te);
  let S;
  if (t < T.Tp) S = T.vs * (T.Rp + T.w1 * Math.tanh((T.Tp - t) / T.w1));
  else {
    const tau = t - T.Tp, d = T.T - tau;
    S = T.vs * (T.w2 * (T.thT - Math.tanh(tau / T.w2)) - T.fT * d - T.dfT * d * d / 2) / T.g0;
  }
  return T.XL + E + S;
}

// a number given as a number or a numeric string, else null (a director's "open_at": "soon" must not stop the film)
function reel_num(v) {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '' && isFinite(+v)) return +v;
  return null;
}
// the edge legend: uppercase, ≤ max characters, cut at the last ' · ' (else the last word + '…'), never mid-word
function reel_legend(s, max) {
  s = String(s || '').toUpperCase().trim();
  if (s.length <= max) return s;
  const k = s.lastIndexOf(' · ', max);
  if (k > 0) return s.slice(0, k);
  const w = s.lastIndexOf(' ', max - 1);
  return (w > 0 ? s.slice(0, w) : s.slice(0, max - 1)).replace(/[\s·,;:–-]+$/, '') + '…';
}

// the baseline for a line that rises out of a mask line INTO ink (the strip, the tab's ink stripe): a descender
// (g j p q y) cut by the mask would fuse with that ink, so lift the line until the descender clears it by `gap`.
// Capitals keep the spec baseline.
function reel_base(text, size, weight, base, maskY, gap) {
  const c = reel_base.c || (reel_base.c = document.createElement('canvas').getContext('2d'));
  c.font = `${weight} ${size}px ${ALM.font}`;
  const desc = c.measureText(String(text || '')).actualBoundingBoxDescent;
  return Math.min(base, maskY - (gap == null ? 6 : gap) - Math.max(0, desc));
}
// core rise() with a floor on the size: shrink to maxW, but never below min (then it runs long and says so)
function reel_rise(parent, text, o, min) {
  let h = rise(parent, text, o);
  if (h.size < min) {
    parent.removeChild(h.mask);
    console.warn(`reel: "${text}" needs ${h.size.toFixed(0)} px to fit ${o.maxW} px; kept at ${min} px`);
    h = rise(parent, text, Object.assign({}, o, { size: min, maxW: 0 }));
  }
  return h;
}

// the camera at (whole-frame) time ts: the matrix (z, 0, 0, z, e, f) for the card DOM and the strip canvas.
// From the top of the spin it breathes in 1.2 % about the gate while the strip coasts down; the dive is exponential
// in scale, smoothstep in time, gate centre (960, 600) → (960, 540); then a slow 2 % push on the film.
function reel_cam(p, ts) {
  const R = p.R, T = p.T;
  let z, cy = 600, q = 0;
  if (p.open) {
    q = smooth(seg(ts, p.Tz, p.Tz + R.DIVE));
    z = (1 + 0.012 * smooth(seg(ts, T.Tp, p.Tz))) * Math.pow(R.Z1, q) * (1 + 0.02 * smooth(seg(ts, p.Tz + R.DIVE, D)));
    cy = lerp(600, 540, q);
  } else z = 1 + 0.012 * smooth(seg(ts, T.Tp, D));
  return { z, e: 960 - 960 * z, f: cy - 600 * z, q };
}

// which clip is printed on cell i: the gate cell carries the gate clip; every other cell the clip reel_plan gave
// it by visibility (p.clipAt, indexed from the strip's head iLead)
function reel_clipOf(p, i) {
  if (i === p.T.g) return p.gate;
  const k = p.clipAt && p.clipAt[i - p.R.iLead];
  return k == null ? p.others[0] : k;
}
// how far cell i has developed at ts (0 raw → 1 printed): left to right as the strip glides in; cells from 3 on are
// off-frame until then and always printed
function reel_dev(i, ts) { return i >= 3 ? 1 : ease3(ts, 0.55 + 0.09 * Math.max(0, i + 1), 0.35); }
// the strip's speed at t, screen px per frame (the transport is analytic: a centred difference)
function reel_speed(T, t, z) { const h = 1 / 240; return Math.abs(reel_X(T, t + h) - reel_X(T, t - h)) / (2 * h) / ALM.fps * z; }
// the perforation rows' anti-alias, 0 → 1 with the speed. Two rows of 74 px-pitch holes are the one strongly
// periodic thing on the strip: above 37 px/frame (half a pitch) their motion aliases — frozen at 74, running
// backwards in between — and the 180° exposure smear leaves the fundamental at 55–95 % there. So from 18 px/frame
// the rows cross-fade (smoothstep in the speed, which is itself smooth, so the fade has no kink) to what a smear of
// one whole pitch prints — the holes' mean transmission, which cancels the fundamental and every harmonic — and
// they are that band from 40 px/frame up: ≤ 5 % of the holes' contrast is left where they would alias. On the way
// down the holes come back out of the band, sharp by 18 px/frame (the glide under the title runs at 12–18).
function reel_perfAA(v) { return smooth((v - 18) / 22); }
// the footage frame on cell i at whole-frame time ts: the cell's own playhead, started when it came into view (or
// later, for a clip shorter than its cell's time on screen: reel_plan)
function reel_frame(p, i, ts) {
  const c = p.cells[i - p.R.iLead], F = p.F;
  if (!c || !F.n) return 0;
  let k = c.base + clamp(Math.floor((ts - c.a) * F.fps + 1e-4), 0, c.n - 1);
  k = Math.min(k, c.len - 1);
  return c.c0 + k;
}

// the strip, drawn every frame with the camera matrix (z, 0, 0, z, e, f).
// Exposure blur: the renderer averages `shutter` sub-frames spread over half a frame (a 180° shutter). The strip
// moves as ONE layer, so its true motion blur is a horizontal box filter over the distance it travels during this
// sub-frame's slice of the exposure (1/60 s ÷ shutter). Paint it once into a wider scratch canvas, then build the
// box by DOUBLING (pass k averages the layer with itself shifted 2^k·s, 'lighter' at .5 + .5 = an exact average,
// transparency included), with taps ≤ 2.5 px apart (at 5 px the smeared perforations and legends showed a fine
// vertical comb at the peak) and only n roundings (1/K per tap in 8 bits would posterize the darks). Below 1.5 px of
// travel per slice it is one sharp paint, so the blur fades out as the strip coasts down. The perforation rows
// also fade into their one-pitch band while the strip is fast (reel_perfAA), so they never wagon-wheel.
function reel_strip(p, t, ts, z, e, f) {
  const out = p.ctx, R = p.R, T = p.T;
  reel_reset(out); out.clearRect(0, 0, W, H);
  if (t < T.t0) return;
  const X = reel_X(T, t);
  const L = Math.abs(X - reel_X(T, t + p.expo)) * z;                           // screen px moved in this slice
  const aa = reel_perfAA(reel_speed(T, t, z));                                  // the perforation rows' band share
  if (L < 1.5) {
    // slow enough for one sharp paint: at the MIDDLE of the slice, where the smeared paint below has its centroid,
    // so the hand-over from smear to sharp (≈ 9 px/frame at shutter 3) moves nothing
    const Xm = reel_X(T, t + p.expo / 2);
    // the dive: a zoom blur over one exposure (half a frame) CENTRED on the frame time ts, so the blurred strip's
    // mean position stays in register with the card DOM, which moves in whole frames and stays sharp (a raw-t card
    // at shutter 3 stacks three contours of the title; the title has left the frame by the fastest part anyway).
    // Paint the strip at the camera a quarter frame early; between that camera and the one a quarter frame late,
    // screen points move by x → r·x + c, a scale by r about the fixed point c / (1 − r). Build the taps by the same
    // doubling: pass k averages the layer with itself scaled by rs^(2^k) about that point, so n passes give 2^n taps
    // from r^0 to r^1.
    const dq = 0.25 / ALM.fps, dive = p.open && ts > p.Tz - dq && ts < p.Tz + R.DIVE + dq;
    const c1 = dive ? reel_cam(p, ts - dq) : null, c2 = dive ? reel_cam(p, ts + dq) : null;
    const r = dive ? c2.z / c1.z : 1;
    if (!dive || (r - 1) * 1200 < 2) { reel_paint(p, out, t, ts, z, e, f, Xm, 0, aa); return; }
    const xs = (c2.e - r * c1.e) / (1 - r), ys = (c2.f - r * c1.f) / (1 - r);
    const far = Math.hypot(Math.max(xs, W - xs), Math.max(ys, H - ys)), Lz = (r - 1) * far;
    const n = Math.min(6, Math.max(1, Math.ceil(Math.log2(Lz / 3 + 1)))), rs = Math.pow(r, 1 / (Math.pow(2, n) - 1));
    let A = p.tA, B = p.tB;
    reel_reset(A); A.clearRect(0, 0, W, H);
    reel_paint(p, A, t, ts, c1.z, c1.e, c1.f, Xm, 0, aa);
    for (let k = 0; k < n; k++) {
      const sk = Math.pow(rs, Math.pow(2, k));
      reel_reset(B); B.clearRect(0, 0, W, H);
      B.globalCompositeOperation = 'lighter'; B.globalAlpha = 0.5;
      B.drawImage(A.canvas, 0, 0, W, H, 0, 0, W, H);
      B.setTransform(sk, 0, 0, sk, xs - sk * xs, ys - sk * ys);
      B.drawImage(A.canvas, 0, 0, W, H, 0, 0, W, H);
      const c = A; A = B; B = c;
    }
    reel_reset(A); out.drawImage(A.canvas, 0, 0, W, H, 0, 0, W, H);
    return;
  }
  const Wb = W + R.MB, y0 = Math.max(0, Math.floor(f + z * (R.Y0 - 100))), y1 = Math.min(H, Math.ceil(f + z * (R.Y0 + R.SH + 130)));
  let A = p.tA, B = p.tB;
  reel_reset(A); A.clearRect(0, 0, Wb, H);
  reel_paint(p, A, t, ts, z, e, f, X, R.MB, aa);                                // MB px of strip past the right edge
  const Lc = Math.min(L, R.MB), n = Math.max(1, Math.ceil(Math.log2(Lc / 2.5 + 1))), s = Lc / (Math.pow(2, n) - 1);
  for (let k = 0; k < n; k++) {
    reel_reset(B); B.clearRect(0, y0, Wb, y1 - y0);
    B.globalCompositeOperation = 'lighter'; B.globalAlpha = 0.5;
    B.drawImage(A.canvas, 0, y0, Wb, y1 - y0, 0, y0, Wb, y1 - y0);
    B.drawImage(A.canvas, 0, y0, Wb, y1 - y0, -s * Math.pow(2, k), y0, Wb, y1 - y0);   // it moves left over the exposure
    const c = A; A = B; B = c;
  }
  reel_reset(A); out.drawImage(A.canvas, 0, y0, W, y1 - y0, 0, y0, W, y1 - y0);
}
function reel_reset(x) { x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = 'source-over'; x.globalAlpha = 1; }
// paint the strip at offset X into context x (x's canvas may be `extra` px wider than the frame)
function reel_paint(p, x, t, ts, z, e, f, X, extra, aa) {
  const R = p.R, F = p.F;
  x.setTransform(z, 0, 0, z, e, f);
  const vx0 = -e / z, vx1 = (W + extra - e) / z, vy0 = -f / z, vy1 = (H - f) / z;  // what the camera sees
  if (R.Y0 > vy1 || R.Y0 + R.SH < vy0) return;
  const lead = R.GX + X + R.iLead * R.P - R.GAP / 2;                              // the strip's cut end
  const bx0 = Math.max(lead, vx0 - 80), bx1 = vx1 + 80;
  if (bx1 <= bx0) return;
  // the body and its shadow on the card (shadow sizes are device px, so they scale with the camera by hand)
  x.save();
  x.shadowColor = 'rgba(0,0,0,.55)'; x.shadowBlur = 36 * z; x.shadowOffsetY = 18 * z;
  x.fillStyle = R.BODY; x.fillRect(bx0, R.Y0, bx1 - bx0, R.SH);
  x.restore();
  // the cells in view
  const iA = Math.max(R.iLead, Math.floor((vx0 - R.GX - X) / R.P) - 1), iB = Math.ceil((vx1 - R.GX - X) / R.P) + 1;
  x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
  x.font = `700 13px ${ALM.font}`; x.textBaseline = 'alphabetic';
  for (let i = iA; i <= iB; i++) {
    const cx = R.GX + X + i * R.P;
    if (cx > vx1 || cx + R.CW < vx0) continue;
    // develop, left to right as the strip glides in; cells from 3 on are off-frame until then
    const dev = reel_dev(i, ts);
    x.fillStyle = R.RAW; x.fillRect(cx, R.IY, R.CW, R.CH);
    if (dev <= 0) continue;
    if (F.n) F.draw(x, reel_frame(p, i, ts), cx, R.IY, R.CW, R.CH, { grade: p.grade });
    if (dev < 1) {
      // the picture rises out of the strip's black like a print in the tray: multiply by dev, floored at the
      // strip's ink, so the highlights come up first and the shadows last
      const v = Math.round(255 * dev);
      x.globalCompositeOperation = 'multiply'; x.fillStyle = `rgb(${v},${v},${v})`; x.fillRect(cx, R.IY, R.CW, R.CH);
      x.globalCompositeOperation = 'lighten'; x.fillStyle = R.RAW; x.fillRect(cx, R.IY, R.CW, R.CH);
      x.globalCompositeOperation = 'source-over';
    }
    // the edge print develops with its cell: key code + frame number on top, the legend of THIS cell's clip below
    x.globalAlpha = 0.92 * dev; x.fillStyle = ALM.mustard;
    x.fillText(p.counter + String(i + 1 - R.iLead).padStart(4, '0'), cx + 10, 436);
    const lg = p.legends[reel_clipOf(p, i)];
    if (lg) x.fillText(lg, cx + 10, 777);
    x.globalAlpha = 1;
  }
  // perforations: real holes, so the mustard shows through the top row, the paper through the bottom one and
  // the charcoal off the card. When the strip is fast (m > 0, reel_perfAA) each row is also the band a one-pitch
  // smear makes of it: the web between the holes lets through the holes' mean share (24/74 in the straight rows,
  // less in the rows of the rounded corners), the holes the rest. Band first at m·share, then the holes at
  // 1 − m(1 − share)/(1 − m·share): together exactly the linear mix (1 − m)·holes + m·band.
  const o0 = R.GX + X + R.PX, k0 = Math.floor((Math.max(lead, vx0) - o0) / R.PERF) - 1, k1 = Math.ceil((vx1 - o0) / R.PERF) + 1;
  const kLead = Math.ceil((lead + 8 - o0) / R.PERF), m = clamp(aa || 0);
  x.save(); x.globalCompositeOperation = 'destination-out';
  if (m > 0) {
    const hx0 = Math.max(o0 + Math.max(k0, kLead) * R.PERF, bx0), hx1 = bx1;
    const share = R.PW / R.PERF, cut = (1 - Math.PI / 4) * R.PR * R.PR * 2 / R.PR;   // a corner row loses ~2.1 px
    if (hx1 > hx0) for (const y of [R.PT, R.PB]) {
      x.globalAlpha = m * share;
      x.fillRect(hx0, y + R.PR, hx1 - hx0, R.PH - 2 * R.PR);
      x.globalAlpha = m * (R.PW - cut) / R.PERF;
      x.fillRect(hx0, y, hx1 - hx0, R.PR); x.fillRect(hx0, y + R.PH - R.PR, hx1 - hx0, R.PR);
    }
    x.globalAlpha = 1 - m * (1 - share) / (1 - m * share);
  }
  if (m < 1) {
    x.beginPath();
    for (let k = Math.max(k0, kLead); k <= k1; k++) {
      const hx = o0 + k * R.PERF;
      x.roundRect(hx, R.PT, R.PW, R.PH, R.PR); x.roundRect(hx, R.PB, R.PW, R.PH, R.PR);
    }
    x.fill();
  }
  x.restore();
}

// the paragraph on the paper: 2 lines at 34 px (B's size); 3 lines at 28 px; more is cut to 3 with an ellipsis
function reel_para(parent, text) {
  const base = { x: 55, w: 1400, weight: 600, color: ALM.engraved, shadow: ALM_ENGRAVE };
  let h = fadeLines(parent, text, Object.assign({ baseline: 791, size: 34, lh: 48 }, base));  // screen 888 / 936
  if (h.lines.length <= 2) return h;
  parent.removeChild(h.el);
  h = fadeLines(parent, text, Object.assign({ baseline: 775, size: 28, lh: 40 }, base));      // screen 872 / 912 / 952
  if (h.lines.length <= 2) { h.top += 8; h.el.style.top = almPx(h.top); }                      // 2 lines: 880 / 920
  if (h.lines.length > 3) {
    console.warn(`reel: the paragraph needs ${h.lines.length} lines; cut to 3 (keep it ≤ 150 characters)`);
    for (const l of h.lines.splice(3)) l.remove();
    const l3 = h.lines[2], words = l3.textContent.split(' ');
    if (words.length > 1) words.pop();
    l3.textContent = words.join(' ').replace(/[\s,;:.–-]+$/, '') + '…';
  }
  return h;
}

// the cells' clips and playheads, in three steps.
// 1. Visibility. For every cell that can come into view: when it is first and last on screen (camera included), and
//    how READABLE it is, in 0.1 s bins: its on-screen share × a speed weight (1 up to 10 px/frame, smoothstep to 0
//    at 50) × how far it has developed. Totals at D 9.6: g−1 and g+1 at rest ≈ 2.2 s each, the three glide cells
//    0.54–0.61, the cell that slides past into the left sliver 0.35, the head and the right sliver ≈ 0.1, the whirr
//    (cells 3 to g−3) 0.
// 2. Clips by visibility, not by position. The non-gate clips, in the order they are listed, go to the cells from
//    the most readable down, one clip per cell: the first listed clips are the ones seen longest (the two that rest
//    beside the gate), then the glide. When the clips run out, each remaining cell (most readable first) takes the
//    clip that clashes least: never a neighbour's clip when another will do, then the smallest readable overlap in
//    time with the cells already printing it (a repeat only while the other copy is off screen or a blur), then
//    the clip seen least. So repeats land on the whirr, never on two cells you can read.
// 3. Frames. Per clip, the gate cell and then the most readable cells get their runs first, one after another (no
//    frame is printed twice); cells that are hardly readable take what is left, or borrow a run from the start of
//    the clip. The gate cell plays from its first appearance to the end of the scene. A readable cell whose clip is
//    shorter than its time on screen starts its playhead that much later: it holds its first frame while it comes
//    in (fast, or still developing) and plays to its last frame as it leaves, instead of freezing on screen where
//    it is read — the gate above all, whose end is the full-frame film. With too few shots for the readable cells,
//    a cell that repeats a clip another readable cell shows at the same time never plays in step with it (the same
//    frame in two cells at once reads as a mirror): its playhead runs half a second ahead of or behind every such
//    copy, whichever holds a frame least while it can be read.
function reel_plan(p) {
  const R = p.R, T = p.T, F = p.F, fps = F.fps || 15, cells = [];
  const nC = Math.max(1, F.cuts.length), lenOf = k => (k + 1 < F.cuts.length ? F.cuts[k + 1] : F.n) - F.cuts[k];
  const dt = 1 / 120, NB = Math.ceil(D / 0.1) + 1;
  for (let i = R.iLead; i <= T.g + 3; i++) {
    let a = null, b = null, slow = 0, score = 0;
    const rd = new Float64Array(NB), on = new Float64Array(NB);
    for (let t = T.t0; t <= D + 1e-9; t += dt) {
      const ts = almSharp(t), c = reel_cam(p, ts), X = reel_X(T, t);
      const l = c.e + c.z * (R.GX + X + i * R.P), r = l + c.z * R.CW;
      if (l < W && r > 0) {
        if (a == null) a = ts; b = t;
        const v = Math.abs(reel_X(T, t + 1 / 30) - X) * c.z;
        if (v < 40) slow += dt;
        const frac = (Math.min(r, W) - Math.max(l, 0)) / (r - l), q = Math.min(NB - 1, Math.floor(t / 0.1));
        const u = frac * (1 - smooth((v - 10) / 40)) * reel_dev(i, ts) * dt;
        rd[q] += u; on[q] += frac * dt; score += u;
      }
    }
    cells.push({ i, k: 0, a: a == null ? D : a, v0: a == null ? D : a, b: b == null ? D : b, slow, score, rd, on,
      n: a == null ? 1 : Math.floor((b - a) * fps) + 2, base: 0 });
  }
  // 2. the clips
  const o = p.others, held = new Map(), clipAt = p.clipAt = cells.map(() => null);
  const give = (c, k) => { c.k = k; clipAt[c.i - R.iLead] = k; if (!held.has(k)) held.set(k, []); held.get(k).push(c); };
  const gc = cells.find(c => c.i === T.g);
  if (gc) give(gc, p.gate);
  const rest = cells.filter(c => c.i !== T.g).sort((u, v) => v.score - u.score || u.i - v.i);
  rest.slice(0, o.length).forEach((c, j) => give(c, o[j]));
  for (const c of rest.slice(o.length)) {
    let best = null, bk = null;
    o.forEach((k, j) => {
      const hs = held.get(k) || [];
      const nb = hs.some(h => Math.abs(h.i - c.i) === 1) ? 1 : 0;
      let clash = 0, seen = 0;
      for (const h of hs) { seen += h.score + 0.02; for (let q = 0; q < NB; q++) clash += c.on[q] * h.rd[q] + c.rd[q] * h.on[q]; }
      const key = [nb, Math.round(clash * 1e3), seen, -j];
      const z = bk ? key.findIndex((x, y) => x !== bk[y]) : -1;
      if (!bk || (z >= 0 && key[z] < bk[z])) { best = k; bk = key; }           // lexicographic: the first difference
    });
    give(c, best);
  }
  for (const c of cells) { c.c0 = F.cuts[c.k] || 0; c.len = Math.max(1, F.n ? lenOf(c.k) : 1); }
  if (!F.n) return cells;                                              // no film: almFootage has said so already
  // 3. the frames
  const short = [], LAG = 0.5;
  const zero = c => c.a - c.base / fps;                              // when c's playhead is on the clip's frame 0
  const holds = (c, z) => {                                          // readable seconds c holds a frame when zeroed at z
    let s = 0;
    for (let q = 0; q < NB; q++) { const tq = (q + 0.5) * 0.1; if (tq < z || tq > z + (c.len - 1) / fps) s += c.rd[q]; }
    return s;
  };
  for (let k = 0; k < nC; k++) {
    const mine = cells.filter(c => c.k === k && c.a < D).sort((u, v) => (v.i === T.g) - (u.i === T.g) || v.score - u.score);
    let cur = 0;
    const read = [];                                                 // this clip's readable cells, as planned
    for (const c of mine) {
      const left = c.len - cur;
      if (c.n <= left) { c.base = cur; cur += c.n; if (c.score >= 0.15 || c.i === T.g) read.push(c); continue; }
      if (c.score < 0.15 && c.i !== T.g) {
        // hardly readable (the whirr, a sliver at the frame edge): the frames that are left when there are a few
        // (it holds the last one), else a run from the start of the clip (a repeat nobody can read)
        if (left >= Math.min(c.n, 4)) { c.base = cur; c.n = left; cur = c.len; } else { c.base = 0; c.n = Math.min(c.n, c.len); }
        continue;
      }
      // the clip is shorter than the cell is on screen: all of it, its playhead started late enough to end with
      // the cell (the first frame holds while the cell comes in); else a run that repeats another cell's frames
      const late = c.len < c.n, need = c.n;
      c.base = late ? 0 : Math.max(0, Math.min(cur, c.len - c.n));
      let how = late ? `holds its first frame ${((c.n - c.len) / fps).toFixed(1)} s` : 'repeats frames';
      cur += c.n;
      if (late) { c.a += (c.n - c.len) / fps; c.n = c.len; }
      // on screen together with another readable copy of the clip, it never plays in step with it (two cells, one
      // frame, the same moment reads as a mirror): its playhead runs LAG s ahead of or behind every such copy,
      // whichever holds a frame least while it can be read
      const both = read.filter(h => h.v0 < c.b && c.v0 < h.b);
      const apart = z => both.every(h => Math.abs(z - zero(h)) >= LAG - 1e-6);
      if (!apart(zero(c))) {
        let z = null, zc = 0;
        for (const h of both) for (const t of [zero(h) - LAG, zero(h) + LAG]) {
          if (!apart(t)) continue;
          const s = holds(c, t);
          if (z == null || s < zc - 1e-6) { z = t; zc = s; }
        }
        const h = both.reduce((u, v) => (Math.abs(zero(v) - z) < Math.abs(zero(u) - z) ? v : u));
        how = `runs ${LAG} s ${z < zero(h) ? 'ahead of' : 'behind'} cell ${h.i}, which shows it too`;
        c.base = 0; c.a = z; c.n = c.len;
      }
      short.push({ k, i: c.i, need, left: Math.max(0, left), how });
      read.push(c);
    }
  }
  for (let k = 0; k < nC; k++) {                                     // one line per clip
    const sh = short.filter(x => x.k === k);
    if (sh.length) console.warn(`reel: clip ${k} (${(F.clips[k] && F.clips[k].src) || ''}, ${lenOf(k)} frames) is short: ` +
      sh.map(x => `cell ${x.i} needs ${x.need}, ${x.left} left, ${x.how}`).join('; ') + ' (lengthen the clip or give more shots)');
  }
  return cells;
}

SCENES.reel = {
  build() {
    groundCharcoal();
    const R = reel_geom();
    const fo = S.footage || {};
    // exposure: flat, hazy archive (p99 − p1 < 186 levels) is lifted per clip to ink blacks and 0.86-paper whites
    const F = almFootage(Array.isArray(fo) ? fo : Object.assign({ levels: 'auto' }, fo));
    if (F.n && F.fps !== 15 && F.fps !== 30) console.warn(`reel: footage fps ${F.fps}; 15 is the norm`);
    // no film, no dive: the camera would dive into an empty black cell, so the reel holds on its card (kits.py
    // _with_props sets open: false for the same case; this keeps a hand-written scene from diving into black)
    const open = S.open !== false && D >= 6.6 && F.n > 0;
    // the dive: open_at, else 5.1 s (extra duration goes to the film after the dive, not to the still card); it must
    // leave 3 s for the dive and the tab (tab complete ≤ Tz + 2.0, still ≥ 1 s)
    const oa = reel_num(S.open_at);
    if (S.open_at != null && oa == null) console.warn(`reel: open_at ${JSON.stringify(S.open_at)} is not a time; the dive starts at 5.1 s`);
    const Tz = clamp(oa != null ? oa : 5.1, 3.6, D - 3.0);
    if (D < 3.6) console.warn(`reel: D ${D} s is short; the reel needs 3.6 s (6.6 s with the dive)`);
    if (open && oa != null && Math.abs(Tz - oa) > 1e-3) console.warn(`reel: open_at ${oa} moved to ${Tz.toFixed(2)} (range 3.6 … D − 3.0)`);
    // the strip comes to rest just before the dive (or ~0.5 s before the end without one), never later than 5.08 s
    // (and never before 2.2 s, where the spin has no room left: only a D under the reel's 3.6 s gets there)
    const T = reel_transport(R, Math.max(2.2, Math.min(5.08, open ? Tz - 0.02 : D - 0.5)));
    // the clips: the gate clip ("gate": true, else the last one) and the others in the order they are listed, which
    // is the order of visibility (reel_plan): the first two rest beside the gate, the next three are the glide
    const clipsIn = F.clips || [], nC = Math.max(1, F.cuts.length);
    let gate = clipsIn.findIndex(c => c && c.gate);
    if (gate < 0 || gate >= nC) gate = nC - 1;
    let others = [...Array(nC).keys()].filter(k => k !== gate);
    if (!others.length) others = [gate];
    const shots = new Set(others.filter(k => k !== gate).map(k => (clipsIn[k] && clipsIn[k].src) || k)).size;
    if (F.n && shots < 4) console.warn(`reel: ${shots} different shot${shots === 1 ? '' : 's'} besides the gate, so readable cells ` +
      `repeat ${shots === 1 ? 'it' : shots ? 'them' : 'the gate shot'}: give 5–8 (two rest beside the gate, three glide, the rest pass the edges)`);
    // the edge legend of each clip: its own edge, else S.edge; uppercase, ≤ 48 characters, cut at a ' · '
    const legends = [...Array(nC).keys()].map(k => reel_legend((clipsIn[k] && clipsIn[k].edge) || S.edge || '', 48));
    const counter = S.counter != null && String(S.counter) !== '' ? String(S.counter) + '  ' : '';

    // the camera: the card lives in it and gets the dive as a CSS matrix about the top-left corner
    const cam = almCam(); cam.style.transformOrigin = '0 0';
    const C = makeCard({ parent: cam });                                // 134–1786 x 86–994, inner (145, 97) 1630 x 886
    const band = almFill(C.inner, 0, 0, C.iw, 363, S.band || ALM.mustard);             // screen y 97–460
    const paper = almFill(C.inner, 0, 651, C.iw, C.ih - 651, ALM.paperStock);          // screen y 748–983
    // the title at B's scale: cap ≈ 175 px, ink from screen x 240, ≤ 1440 wide (B's 95 px margins in the band)
    const tOpt = { x: 95, baseline: 257, size: 246, weight: ALM.wTitle, ls: -0.035, color: ALM.ink, maskY: 283, maxW: 1440,
      shadow: '3px 2px 0 ' + ALM.cream };
    let title = rise(C.inner, S.title || '', tOpt);                     // mask line = the strip's top edge (screen 380)
    const tb = reel_base(S.title, title.size, ALM.wTitle, 257, 283, 6);
    if (tb < 257) { C.inner.removeChild(title.mask); title = rise(C.inner, S.title || '', Object.assign(tOpt, { baseline: tb, size: title.size, maxW: 0 })); }
    const para = reel_para(C.inner, S.text || '');
    cardFinish(C, { grain: 2.2, grainRect: [0, 651, C.iw, C.ih - 651] });

    // the strip: screen-space canvas above the card, drawn with the camera matrix
    const cv = document.createElement('canvas'); cv.className = 'full'; cv.width = W; cv.height = H;
    scene.appendChild(cv);
    const scratch = () => { const c = document.createElement('canvas'); c.width = W + R.MB; c.height = H; return c.getContext('2d'); };

    // the index tab, hung from the top edge 96 px in (action-safe, clear of the player's top-left title), its
    // bottom corners rounded like the card: mustard block, ink stripe, paper strip, the name rising out of the
    // stripe's top edge. Width ≤ 1100: the name fits 980 px (floor 64 px), the sub 760 px.
    const lab = S.label || {};
    let tab = null;
    if (open && lab.name) {
      const el = document.createElement('div'); el.className = 'abs';
      el.style.cssText = 'left:96px;top:0;filter:drop-shadow(0 10px 22px rgba(0,0,0,.38))';
      scene.appendChild(el);
      const box = document.createElement('div'); box.className = 'abs';
      box.style.cssText = 'left:0;top:0;overflow:hidden;border-radius:0 0 14px 14px';
      el.appendChild(box);
      const sub = document.createElement('div'); sub.className = 'abs';
      sub.style.cssText = `left:58px;top:186px;white-space:pre;font-weight:700;font-size:30px;line-height:36px;color:${ALM.ink};opacity:0`;
      box.appendChild(sub);
      const subFits = s => { sub.textContent = s; return sub.offsetWidth <= 760; };
      const full = String(lab.sub || '');
      if (!subFits(full)) {
        const w0 = sub.offsetWidth, fs = Math.max(24, 30 * 760 / w0);
        sub.style.fontSize = fs.toFixed(1) + 'px';
        if (!subFits(full)) {
          // drop trailing ' · ' fields first, then words (with an ellipsis)
          const fl = full.split(' · ');
          let s = null;
          for (let k = fl.length - 1; k >= 1 && s == null; k--) if (subFits(fl.slice(0, k).join(' · '))) s = fl.slice(0, k).join(' · ');
          if (s == null) {
            const ws = fl[0].split(' ');
            for (let k = ws.length - 1; k >= 1 && s == null; k--) { const c = ws.slice(0, k).join(' ').replace(/[\s,;:–-]+$/, '') + '…'; if (subFits(c)) s = c; }
          }
          console.warn(`reel: the tab's sub "${full}" is too long; set as "${s || ''}"`);
          subFits(s || '');
        }
      }
      const subW = sub.offsetWidth; box.removeChild(sub);
      // the name first (its size and baseline decide the tab's width), then the bands slid in under it
      const nOpt = { x: 56, baseline: 128, size: 108, weight: ALM.wTitle, ls: -0.03, color: ALM.ink, maskY: 150, maxW: 980 };
      const probe = rise(box, lab.name, nOpt);
      box.removeChild(probe.mask);
      const nb = reel_base(lab.name, Math.max(64, probe.size), ALM.wTitle, 128, 150, 6);
      const name = reel_rise(box, lab.name, Object.assign({}, nOpt, { baseline: nb }), 64);
      const Wt = Math.round(Math.max(56 + name.width, 58 + subW) + 64);    // = max(nameW, subW) + 120 with the 56 px inset
      if (Wt > 1100) console.warn(`reel: the tab is ${Wt} px wide (name "${lab.name}" at the 64 px floor)`);
      box.style.width = Wt + 'px'; box.style.height = '236px';
      const tm = almFill(box, 0, 0, Wt, 150, ALM.mustard);
      const tk = almFill(box, 0, 150, Wt, 22, ALM.ink);
      const tp = almFill(box, 0, 172, Wt, 64, ALM.paperStock);
      for (const b of [tp, tk, tm]) box.insertBefore(b, box.firstChild);    // bands under the name's mask
      paperTexture(tm, (S.seed || 7) * 13 + 3, { w: Wt, h: 150, veins: 2, creases: 0, grain: 0 });
      paperTexture(tp, (S.seed || 7) * 17 + 5, { w: Wt, h: 64, veins: 0, creases: 0, grain: 2.2, dust: 0.3 });
      box.appendChild(sub);
      // every name lands within 0.45 s + the 0.5 s settle, so it is still ≥ 1 s even at the latest dive
      tab = { el, tm, tk, tp, name, sub, W: Wt, rate: Math.max(25, (name.n - 1) / 0.45) };
    }

    parts = { R, T, F, open, Tz, gate, others, legends, counter, grade: S.grade || fo.grade || 'mono',
      cam, C, band, paper, title, para, cv, ctx: cv.getContext('2d'), tab,
      tA: scratch(), tB: scratch(),                                                 // the exposure blur's ping-pong
      expo: 0.5 / ALM.fps / Math.max(1, Math.round(+S.shutter || 3)) };          // this sub-frame's exposure slice
    parts.cells = reel_plan(parts);
  },

  frame(t) {
    const p = parts, ts = almSharp(t);
    // the card (reference B's grammar, whole frames). Both bands are up before the strip lands, so its
    // perforations are lit from the first frame they are seen.
    cardFrame(p.C, ts);                                                   // 0 → 0.21 s
    bandWipe(p.band, ease3(ts, 0.12, 0.30), 'down');                      // mustard down
    bandWipe(p.paper, ease3(ts, 0.30, 0.30), 'up');                       // paper up
    riseFrame(p.title, ts, 0.48, 22);                                     // title out of the strip's top edge, once the strip is under it
    fadeLinesFrame(p.para, ts, 0.90, 0.14, 0.40);                         // paragraph, line by line (done ≈ 1.5 s)
    // the camera (whole frames): from the spin's peak it breathes in 1.2 % about the gate, then the dive:
    // exponential in scale, smoothstep in time, gate centre (960, 600) → (960, 540); then a slow 2 % push on the film
    const { z, e, f, q } = reel_cam(p, ts);
    p.cam.style.transform = (z === 1 && f === 0) ? 'none' : `matrix(${z.toFixed(6)},0,0,${z.toFixed(6)},${e.toFixed(3)},${f.toFixed(3)})`;
    p.cam.style.visibility = q >= 1 ? 'hidden' : 'visible';             // the film covers the frame from here on
    reel_strip(p, t, ts, z, e, f);
    // the index tab
    const b = p.tab;
    if (b) {
      const T = p.Tz + 0.85;
      bandWipe(b.tm, ease3(ts, T, 0.30), 'down');
      bandWipe(b.tk, ease3(ts, T + 0.12, 0.28), 'right');
      bandWipe(b.tp, ease3(ts, T + 0.18, 0.30), 'right');
      riseFrame(b.name, ts, T + 0.2, b.rate);
      const u = ease3(ts, T + 0.45, 0.35);
      b.sub.style.opacity = u.toFixed(4); b.sub.style.transform = `translate3d(0,${((1 - u) * 10).toFixed(2)}px,0)`;
    }
  },
};

/* hand.js — SCENES.hand: THE HAND (ALMANAC template 2).
   A deck lands on the charcoal table and fans into a hand of ALMANAC collector cards. Each card turns face-up and
   PRINTS itself in a wave 90 ms apart — reference B's grammar at card size: mustard wipes down, the name rises, the
   stripe runs in, the paper wipes up, the cut-out fades up from pale grey, the engraved line fades in. Then one card
   is pulled out of the hand and flown to the lens with a full turn in the air (its printed back shows mid-air); the
   rest of the hand drops out of focus, the photo stands off the card, and reference A's bars run out from BEHIND the
   card with the reason it matters rising out of them.

   S: { type:'hand', kicker, title (mustard heading on the table, ≤ 18 chars), back (label on every card back),
        series (optional channel / series name: the back's label when back is empty, and "SERIES · 01" under it;
                empty = "No. 01"),
        cards: [2..5] {name (≤ 18; > 8 chars splits into 2 balanced rows), tag (the kicker line: shrunk, then cut at a
                       word, to fit the card), role (≤ 45), image (cut-out PNG, or the prep's {src, ar, edges,
                       edge_alpha}), anchor ('auto' | 'left' | 'right'), dy, no},
        hero (index to pull, default last; -1 = no pull), pull_at (s), hero_title (≤ 60), hero_text (≤ 140) }
   Duration: the scene needs about pull + 3.9 s (the flight, the bars and a 1 s hold). If D is too short for the
   text it does not throw (a thrown error fails the whole kit batch): it shortens the heading's hold first, then the
   side column's, and logs `hand: needs D ≥ X s` with console.warn.

   Built only from core.js (groundCharcoal, almCam, makeCard, cardFinish, almFill, bandWipe, rise, riseFrame, riseEnd,
   riseLines, riseLinesFrame, riseLinesEnd, almWrap, almInk, cutout, almCut, fadeLines, fadeLinesFrame, ALM_ENGRAVE,
   almSharp, smooth, almHoldReady). Helpers private to this file are prefixed hand_.
   Clock: EVERYTHING runs on almSharp(t) (whole frames, like the references). The flight was tried on the raw t: at
   Frontier's shutter 3 its full turn shows three stacked ghosts (a double exposure, not a smear), so it is crisp too. */

const hand_K = {
  CW: 440, CH: 616, R: 22, RI: 26, B: 7, SHADE: 4, // the card: 5:7 trading-card proportion and corners (~5 % of the
                                                 // width); a thin bezel and inner shade (B 9 / R 28 / shade 9 at the
                                                 // hero's 1.4x read as a tablet with a vignette, not print)
  BAND: 232, STRIPE: 44,                         // inner px: mustard 0..232, stripe 232..276, paper 276..598
  CX: 960, CY: 640, PIV: 860,                    // deck centre; the fan pivots 860 px below each card's centre
  CY_RIG: 650,                                   // the hand tilts about (960, 650)
  M: 28,                                         // the cut-out overhangs its hard edges by M: those edges stay glued
  SOFT: 24,                                      // a second hard side edge dissolves over its last SOFT px (a print
                                                 // edge; 64 read as an airbrushed smear at 1.4x)
  PERSP: 2400,
  FAN0: 0.62, STAG: 0.09, FAN_DUR: 0.66, PRINT: 0.34,
  STEP: 20,                                      // max fan step (deg): 15 left "O'BANI|" under the next card at n = 3
  LIFT: 150, ARC: 22,                            // the deal's lift toward the lens and its arc (px): more hit the heading
  PULL: 230, PULL_Z: 120, DIP: 70,               // the pull out of the hand (330/170 sent the hero over the top edge)
  SINK_Y: 470, SINK_X: 200, DIM: 0.62,           // the hand drops out of focus, low-left and dark, under the column
  HEAD_Y: 212,                                   // the heading's baseline
  HERO: { x: 1330, y: 540, z: 160, s: 1.40, rz: -2.2 },
  // the side column: reference A's bar, one per title row, running BEHIND the hero card; the ink title rises out of
  // each bar's bottom edge. BAR_R is the bars' right end (hidden behind the landed card, whose left edge is ~1022).
  COL: { x: 120, b0: 430, size: 72, pitch: 100, padT: 14, padB: 22, barR: 1180, wrap: 760, gap: 34 },
  RIM: 'inset 0 -1.2px 0 rgba(255,255,255,.085),0 0 0 1px rgba(255,255,255,.075)',
};

// ease-out with a small overshoot (c = 1: ~4 %), for a card swinging into its place in the fan
function hand_back(x, c) { x = clamp(x); return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); }

// the prep writes edges as an 'ltrb' subset; older indexes wrote ['bottom','left','right'] — read both
function hand_edges(meta) {
  const e = meta.edges;
  return Array.isArray(e) ? e.map(s => String(s).charAt(0).toLowerCase()).join('') : String(e || '');
}
// which side of the photo was cut by its frame: that side is glued to the card's inner edge
function hand_anchor(c, meta) {
  const a = String(c.anchor || 'auto').toLowerCase();
  if (a === 'left' || a === 'right') return a;
  const e = hand_edges(meta), l = e.includes('l'), r = e.includes('r');
  if (l && !r) return 'left';
  if (r && !l) return 'right';
  // both sides cut: glue the side with clearly more alpha on its border; a near tie (all three sample mugshots:
  // l .23-.28 vs r .25-.27) goes left, because the fan covers every card's right side with the next card
  if (l && r) { const ea = meta.edge_alpha || {}, dl = +ea.l || 0, dr = +ea.r || 0; return dr > dl + 0.08 ? 'right' : 'left'; }
  return 'left';                                 // no hard side: the left side is the one the fan shows
}
// canvas width of a string in the kit face, letter-spacing (em) included
function hand_w(txt, size, wt, ls) {
  const cv = hand_w.cv || (hand_w.cv = document.createElement('canvas').getContext('2d'));
  cv.font = `${wt} ${size}px ${ALM.font}`;
  return cv.measureText(txt).width + (ls || 0) * size * Math.max(0, txt.length - 1);
}
// a long name splits into two rows at the space that makes the WIDER row narrowest ("MACHINE GUN / JACK MCGURN",
// not "MACHINE GUN JACK / MCGURN", which forced the whole name down to ~50 px)
function hand_rows(nm, wt, ls) {
  if (nm.length <= 8 || nm.indexOf(' ') < 0) return [nm];
  let best = null;
  for (let k = nm.indexOf(' '); k > 0; k = nm.indexOf(' ', k + 1)) {
    const a = nm.slice(0, k).trim(), b = nm.slice(k + 1).trim(), w = Math.max(hand_w(a, 66, wt, ls), hand_w(b, 66, wt, ls));
    if (a && b && (!best || w < best.w - 0.5)) best = { w, rows: [a, b] };
  }
  return best ? best.rows : [nm];
}

function hand_card(wrap, c, i, o) {
  const { CW, CH, R, RI, B, SHADE, BAND, STRIPE, M, SOFT } = hand_K;
  const no = c.no != null ? String(c.no) : String(i + 1).padStart(2, '0');
  // ── the face: B's card at trading-card size ──
  const F = makeCard({ parent: wrap, x: 0, y: 0, w: CW, h: CH, r: R, ri: RI, border: B, shade: SHADE });
  const iw = F.iw, ih = F.ih, PAPER = BAND + STRIPE;
  const must = almFill(F.inner, 0, 0, iw, BAND, ALM.mustard);
  const stripe = almFill(F.inner, 0, BAND, iw, STRIPE, ALM.stripe);
  const paper = almFill(F.inner, 0, PAPER, iw, ih - PAPER, ALM.paperStock);   // + grain 2.2 = B's paper (card.js)
  // the kicker line "No. 01 · TAG": shrunk 14 -> 11 px to fit, then the tag is cut at a word (never mid-word)
  const kick = document.createElement('div');
  const kw = iw - 32, kls = 0.16, nbsp = '\u00A0';
  let words = String(c.tag || '').toUpperCase().split(/\s+/).filter(Boolean), ks = 14;
  const ktxt = () => `No.${nbsp}${no}` + (words.length ? `${nbsp}${nbsp}·${nbsp}${nbsp}` + words.join(' ').replace(/[\s,;:·\-–—]+$/, '') : '');
  const kfit = () => hand_w(ktxt(), ks, 800, kls) + kls * ks <= kw;
  while (ks > 11 && !kfit()) ks -= 0.5;
  while (words.length > 1 && !kfit()) words.pop();
  if (!kfit()) words = [];
  kick.style.cssText = `position:absolute;left:16px;top:17px;font-weight:800;font-size:${ks}px;letter-spacing:${kls}em;color:${ALM.ink};white-space:nowrap`;
  kick.textContent = ktxt();
  F.inner.appendChild(kick);
  // the name: one row, or two balanced rows when it is longer than 8 characters, set to the band: shrunk 2 px at a
  // time until the widest row fits (the card's width, or, in the fan, the strip the next card leaves exposed), last
  // baseline 22 px above the band's bottom edge
  const wt = ALM.wTitle, ls = -0.035, maxW = Math.min(iw - 34, o.nameMax || 1e9);
  const rows = hand_rows(String(c.name || '').toUpperCase().trim(), wt, ls);
  const widest = sz => Math.max(...rows.map(r => hand_w(r, sz, wt, ls)));
  let size = 66;
  while (size > 40 && widest(size) > maxW) size -= 2;
  const pitch = Math.round(size * 0.88), last = BAND - 22;
  const name = riseLines(F.inner, rows, { x: 16, baseline: last - (rows.length - 1) * pitch, pitch, size, weight: wt, ls,
    color: ALM.ink, shadow: '-1.5px 1.5px 0 rgba(251,246,234,.9)', rate: 30 });
  // the photo: box iw·.66 + M by ih·.60 + M, overhanging its anchor side and the bottom by M (the inner clips it)
  const meta = almCut(c.image), side = hand_anchor(c, meta), left = side === 'left';
  const cw = Math.round(iw * 0.66) + M, ch = Math.round(ih * 0.60) + M, dy = clamp(+c.dy || 0, -20, 160);
  const cut = cutout(F.inner, c.image, { x: left ? -M : iw - cw + M, y: ih - ch + M + dy, w: cw, h: ch,
    pos: left ? '0% 100%' : '100% 100%', bw: true, shadow: { x: 9, y: 11, blur: 11, a: 0.36 } });
  // a photo cut by BOTH side frames keeps one straight edge inside the card: dissolve it (as bar.js does)
  const e = hand_edges(meta), far = left ? 'r' : 'l';
  if (meta.known && e.includes(far)) {
    const cwc = Math.min(cw, ch * meta.ar), a = Math.max(0, cwc - SOFT), b = Math.max(a + 1, cwc - 2);
    const g = `linear-gradient(${left ? 'to right' : 'to left'},#000 ${almPx(a)},transparent ${almPx(b)})`;
    cut.img.style.webkitMaskImage = g; cut.img.style.maskImage = g;
  }
  // the engraved role line, on the side away from the photo
  // balanced rows (no one-word widow), then fadeLines sets them as forced lines. Only a card whose paper band is
  // never covered prints it (o.role: the top card of the fan and the pulled hero): in the fan the next card covers
  // that side, and the covered cards showed clipped fragments ("Nor / Sh / N") beside it
  const roleTxt = o.role === false ? '' : almWrap(c.role || '', 18, 650, 160, 0).join('\n');
  const role = fadeLines(F.inner, roleTxt, { x: left ? Math.round(iw * 0.60) : 16, y: PAPER + 16, w: 160,
    size: 18, lh: 25, weight: 650, color: '#8E8A85', shadow: ALM_ENGRAVE });
  cardFinish(F, { seed: 101 + i * 7, veins: 3, grain: 2.2, grainRect: [0, PAPER, iw, ih - PAPER] });
  F.inner.insertBefore(cut.el, F.shade);         // the photo above the print, under the bezel's shade
  F.inner.insertBefore(role.el, F.shade);
  F.el.style.backfaceVisibility = 'hidden'; F.el.style.transform = 'translateZ(1px)';
  // ── the back: a printed card back, the same design on every card ──
  const Bk = makeCard({ parent: wrap, x: 0, y: 0, w: CW, h: CH, r: R, ri: RI, border: B, shade: SHADE });
  const frameEl = document.createElement('div');
  frameEl.style.cssText = `position:absolute;inset:18px;border:3px solid ${ALM.mustard};border-radius:14px;` +
    `background:repeating-linear-gradient(45deg,rgba(230,190,97,.10) 0 2px,transparent 2px 13px)`;
  Bk.inner.appendChild(frameEl);
  // the band grows with the label: 38 px type, 30 px from 3 rows on, and never less than 14 px above and below it
  // the back's label: S.back, else S.series (the channel or series name); never the kit's own name, which would
  // end up in every buyer's video
  const bt = String(S.back || S.series || '').toUpperCase(), bw = Bk.iw - 36 - 28;
  let bsz = 38, brows = almWrap(bt, bsz, ALM.wTitle, bw, -0.02);
  if (brows.length >= 3) { bsz = 30; brows = almWrap(bt, bsz, ALM.wTitle, bw, -0.02); }
  const blh = Math.round(bsz * 0.92), bh = Math.max(104, brows.length * blh + 28);
  const band = almFill(Bk.inner, 18, Math.round(Bk.ih / 2 - bh / 2), Bk.iw - 36, bh, ALM.mustard);
  band.style.cssText += `;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;font-weight:${ALM.wTitle};` +
    `font-size:${bsz}px;line-height:${blh}px;letter-spacing:-.02em;color:${ALM.ink};padding:0 14px;white-space:nowrap`;
  band.innerHTML = brows.map(r => `<div>${esc(r)}</div>`).join('');
  const lbl = document.createElement('div');
  lbl.style.cssText = `position:absolute;left:0;right:0;top:${Math.round(Bk.ih / 2 + bh / 2 + 20)}px;text-align:center;font-weight:800;font-size:13px;letter-spacing:.42em;color:${ALM.mustard}`;
  lbl.innerHTML = S.series ? `${esc(String(S.series).toUpperCase())}&nbsp;·&nbsp;${esc(no)}` : `No.&nbsp;${esc(no)}`;
  Bk.inner.appendChild(lbl);
  cardFinish(Bk, { seed: 55 + i, veins: 3 });
  Bk.el.style.backfaceVisibility = 'hidden'; Bk.el.style.transform = 'rotateY(180deg) translateZ(1px)';
  return { F, Bk, must, stripe, paper, kick, name, cut, role, left, dy };
}

// the heading leaves the way it came: its letters drop back into their mask, last letter first (so the right of
// the heading, where a middle card is pulled up, clears first), ease-in over dur, `rate` letters/s
function hand_drop(h, t, t0, rate, dur) {
  if (t <= t0) return;
  for (const c of h.ch) {
    const q = clamp((t - t0 - (h.n - 1 - c.i) / rate) / dur);
    if (q > 0) c.el.style.transform = `translate3d(0,${(h.drop * q * q).toFixed(2)}px,0)`;
  }
}

SCENES.hand = {
  build() {
    groundCharcoal(ALM.charcoal, 0);             // flat: the .06 vignette encoded as a visible ring on the hold
    const cards = S.cards || [], n = cards.length;
    if (n < 2 || n > 5) throw new Error(`hand: needs 2–5 cards, got ${n} (at 6 the names are covered by the next card)`);
    const hero = S.hero == null ? n - 1 : clamp(Math.round(+S.hero), -1, n - 1);
    const cam = almCam();
    // the heading, set on the table (its letters drop back out when a card is pulled)
    const head = document.createElement('div'); head.style.cssText = 'position:absolute;left:0;top:0;width:1920px;height:300px';
    cam.appendChild(head);
    const kicker = document.createElement('div');
    kicker.style.cssText = `position:absolute;left:122px;top:${hand_K.HEAD_Y - 128}px;font-weight:800;font-size:20px;letter-spacing:.22em;color:#8E8A85;text-transform:uppercase;white-space:nowrap`;
    kicker.textContent = S.kicker || ''; head.appendChild(kicker);
    // lower case needs its descenders: the mask sits 0.26 em under the baseline, not core's 0.06 em (capitals)
    const title = rise(head, S.title || '', { x: 120, baseline: hand_K.HEAD_Y, maskY: hand_K.HEAD_Y + 112 * 0.26, size: 112,
      weight: ALM.wTitle, ls: -0.035, color: ALM.mustard, maxW: 1200 });
    // the side column's bars sit UNDER the hand (A's bar runs behind the cut-out; here, behind the hero card)
    const barsEl = document.createElement('div'); barsEl.style.cssText = 'position:absolute;left:0;top:0;width:1920px;height:1080px';
    cam.appendChild(barsEl);
    // the hand, in real perspective. Every face is built here, BEFORE any ancestor gets a transform (rise measures
    // letters in screen space). The table is FLAT (no shared 3D space): each card is projected on its own and the
    // cards are painted in an order set per frame (see frame). In one shared preserve-3d space a card turning
    // edge-on reaches ±220 px in depth and cut through its lifted neighbours (0.83–0.90 s with 3 cards). The hand's
    // 3/4 tilt is folded into every card's own transform instead, so the projection is unchanged.
    const rig = document.createElement('div');
    rig.style.cssText = `position:absolute;left:0;top:0;width:${W}px;height:${H}px;perspective:${hand_K.PERSP}px;perspective-origin:960px 520px`;
    cam.appendChild(rig);
    const step = Math.min(hand_K.STEP, 60 / (n - 1));
    // the strip of a card the next one leaves showing at the name row; every card but the last sets its name to it
    const expose = Math.round((hand_K.PIV + 80) * Math.sin(step * Math.PI / 180) - 24);
    const C = cards.map((c, i) => {
      const wrap = document.createElement('div');
      wrap.style.cssText = `position:absolute;left:${hand_K.CX - hand_K.CW / 2}px;top:${hand_K.CY - hand_K.CH / 2}px;width:${hand_K.CW}px;height:${hand_K.CH}px;transform-style:preserve-3d`;
      rig.appendChild(wrap);
      return Object.assign(hand_card(wrap, c, i, { nameMax: i < n - 1 ? expose : 0, role: i === n - 1 || i === hero }), { wrap, jit: (rnd() - 0.5) * 3.2,
        jx: (rnd() - 0.5) * 8, jy: (rnd() - 0.5) * 6, ang: (i - (n - 1) / 2) * step, ti: hand_K.FAN0 + i * hand_K.STAG });
    });
    // the side column: why the pulled card matters. One mustard bar per title row (A's bar), the ink title rising
    // out of each bar's bottom edge, the paragraph under the last bar.
    const K = hand_K.COL, sideEl = document.createElement('div');
    sideEl.style.cssText = 'position:absolute;left:0;top:0;width:1920px;height:1080px';
    cam.appendChild(sideEl);
    const cap = Math.round(almInk('H', K.size, ALM.wTitle).cap), barH = cap + K.padT + K.padB;
    let rows = S.hero_title ? almWrap(S.hero_title, K.size, ALM.wTitle, K.wrap, -0.03) : [];
    // lay out once to learn the paragraph's height, then lift the block if it would run into the bokeh / off-frame
    let b0 = K.b0;
    const probe = fadeLines(sideEl, S.hero_text || '', { x: K.x, y: 0, w: 700, size: 29, lh: 42, weight: 500 });
    const textH = probe.lines.length * 42; sideEl.removeChild(probe.el);
    const bottom = b0 + (Math.max(1, rows.length) - 1) * K.pitch + K.padB + K.gap + textH;
    if (bottom > 960) b0 -= bottom - 960;
    const htitle = riseLines(sideEl, rows, { x: K.x, baseline: b0, pitch: K.pitch, size: K.size, weight: ALM.wTitle,
      ls: -0.03, color: ALM.ink, shadow: '-1.5px 1.5px 0 rgba(251,246,234,.9)', rate: 34, desc: K.padB / K.size });
    const bars = rows.map((r, k) => almFill(barsEl, 0, b0 + k * K.pitch - cap - K.padT, K.barR, barH, ALM.mustard));
    const lastBottom = b0 + (Math.max(1, rows.length) - 1) * K.pitch + K.padB;
    const htext = fadeLines(sideEl, S.hero_text || '', { x: K.x, y: lastBottom + K.gap, w: 700, size: 29, lh: 42, weight: 500, color: '#BDB8AE' });
    // the side column's clock, relative to T_REST: bar k grows out from behind the card from -0.05 + 0.08·k (0.43 s,
    // eo3); the title's first letter leaves at +0.17, when bar 0 has reached it; the paragraph once the title is up
    const tBar = -0.05, barStag = 0.08, barDur = 0.43, tTitle = 0.17;
    const tText = Math.max(0.62, tTitle + Math.max(0, htitle.n - 1) / htitle.rate + 0.05);
    const sideEnd = Math.max(riseLinesEnd(htitle, tTitle), tBar + Math.max(0, rows.length - 1) * barStag + barDur,
      tText + Math.max(0, htext.lines.length - 1) * 0.13 + 0.42);
    // THE PULL TIME: after the last card has printed and the heading has held 1 s (it leaves at T_PULL - 0.15), and
    // early enough for the flight + a side column held still for 1 s
    const pCards = hand_K.FAN0 + (n - 1) * hand_K.STAG + hand_K.PRINT + 0.9;
    const pHead = riseEnd(title, 0.34, 25) + 1.0 + 0.15;
    const pMin = Math.max(pCards, pHead), pMax = Math.min(D - 3.2, D - 1.0 - (1.10 + sideEnd));
    const want = S.pull_at != null && S.pull_at !== '' && isFinite(+S.pull_at) ? +S.pull_at : clamp(D - 4.15, 2.3, 2.85);
    let T_PULL = Math.max(pMin, Math.min(pMax, want));
    if (hero >= 0 && pMin > pMax + 1e-6) {
      // too short for this text: the heading's hold gives way first, then the side column's (never the print)
      T_PULL = Math.max(pCards, pMax);
      const need = pMin + Math.max(3.2, 2.1 + sideEnd);
      try { console.warn(`hand: needs D ≥ ${need.toFixed(1)} s for this text (got ${D}); holds shortened`); } catch (e) { /* */ }
    }
    // hold the first frame until every photo has decoded
    const imgs = [...scene.querySelectorAll('img')];
    almHoldReady(Promise.all(imgs.map(im => (im.decode ? im.decode() : Promise.resolve()).catch(() => null))));
    parts = { n, hero, C, head, kicker, title, htitle, bars, barsEl, htext, cam, rig, sideEl, T_PULL, tBar, barStag, barDur, tTitle, tText };
  },

  frame(t) {
    const { CX, CY, PIV, M, HERO } = hand_K, p = parts, n = p.n;
    t = almSharp(t);                                                   // whole frames, like the references
    const T_PULL = p.T_PULL, T_GO = T_PULL + 0.34, T_REST = T_PULL + 1.10, pulled = p.hero >= 0;

    // the heading: rises from 0.34; when a card is pulled its letters drop back out from T_PULL - 0.15, last first
    const tOut = T_PULL - 0.15;
    riseFrame(p.title, t, 0.34, 25);
    if (pulled) hand_drop(p.title, t, tOut, 60, 0.25);
    p.kicker.style.opacity = (eo3(clamp((t - 0.30) / 0.40)) * (pulled ? 1 - smooth((t - tOut) / 0.25) : 1)).toFixed(3);

    // the rig: a 3/4 view while it is a hand, square to the lens once a card is pulled (smoothstep: it moves everything)
    const rs = pulled ? smooth((t - T_GO + 0.1) / (T_REST - T_GO + 0.1)) : 0, drift = smooth(t / T_PULL);
    const rigRx = lerp(lerp(11, 8, drift), 0, rs), rigRy = lerp(lerp(-9, -5, drift), 0, rs);
    // the hand's tilt about (960, 650), written in each card's own frame (its origin is the card centre, (960, 640))
    const rigT = `translate3d(0px,${hand_K.CY_RIG - CY}px,0px) rotateX(${rigRx.toFixed(3)}deg) rotateY(${rigRy.toFixed(3)}deg) translate3d(0px,${CY - hand_K.CY_RIG}px,0px) `;
    // the deck slides in from 640 px below over 0.62 s and fades up over its first frames: from 820 px in 0.52 s it
    // moved 142 px in one unblurred frame and read as a jump. (The fade is on the rig: opacity on a card's own
    // preserve-3d wrapper would flatten it and show its face through the back.)
    const din = eo3(clamp(t / 0.62));
    const deckY = (1 - din) * 640, deckR = (1 - din) * -7;
    p.rig.style.opacity = t >= 0.16 ? '1' : eo3(clamp(t / 0.16)).toFixed(3);

    p.C.forEach((c, i) => {
      const ti = c.ti, fp = clamp((t - ti) / hand_K.FAN_DUR);
      // rotation about the pivot below the hand; the card lifts clear of the pile BEFORE it turns (√sin lift)
      const a = lerp(c.jit, c.ang, hand_back(fp, 1.0)), ar = a * Math.PI / 180;
      let x = CX + PIV * Math.sin(ar) + (1 - fp) * (c.jx + 1.4 * i);
      let y = CY + PIV - PIV * Math.cos(ar) + (1 - fp) * (c.jy + 2.6 * i) - hand_K.ARC * Math.sin(Math.PI * fp) + deckY;
      let z = lerp((n - 1 - i) * 2.6, i * 9, fp) + hand_K.LIFT * Math.sqrt(Math.sin(Math.PI * fp));
      let rz = a + deckR, ry = 180 * (1 - eo3(clamp((t - ti - 0.09) / (hand_K.FAN_DUR - 0.11)))), rx = -10 * Math.sin(Math.PI * fp), s = 1;
      let blur = 0, dim = 0, lift = 0;
      if (i === p.hero) {
        const pa = smooth((t - T_PULL) / 0.46), pb = smooth((t - T_GO) / (T_REST - T_GO)), hold = smooth((t - T_REST) / (D - T_REST));
        const pl = hand_K.PULL * pa;                                                  // out of the hand, clear of it
        x += pl * Math.sin(ar); y -= pl * Math.cos(ar); z += hand_K.PULL_Z * pa;
        // the flight dips on its way to the lens (+70·sin πpb): mid-turn the card is ~1.2x and its near edge swings
        // toward the lens, and a middle hero pulled straight up came within 13 px of the top edge without it
        x = lerp(x, HERO.x, pb); y = lerp(y, HERO.y, pb) + hand_K.DIP * Math.sin(Math.PI * pb); z = lerp(z, HERO.z, pb);
        rz = lerp(rz, HERO.rz, pb); s = lerp(1, HERO.s, pb);
        ry = lerp(ry, 0, pb) - 360 * pb + pb * lerp(-13, -5, hold);                    // one full turn in the air
        rx = lerp(rx, 0, pb) + pb * lerp(5, 2, hold);
        lift = eo3(clamp((t - T_REST + 0.15) / 0.60));
      } else if (pulled) {
        const nb = Math.abs(i - p.hero) === 1 ? 1 : 0;                                 // the neighbours feel the pull
        rz += Math.sin(Math.PI * clamp((t - T_PULL) / 0.5)) * nb * (i < p.hero ? -1.6 : 1.6);
        const sink = smooth((t - T_PULL - 0.25) / (T_REST - T_PULL - 0.15));
        y += hand_K.SINK_Y * sink; x -= hand_K.SINK_X * sink; z -= 280 * sink; blur = 9 * sink; dim = hand_K.DIM * sink;
      }
      c.wrap.style.transform = rigT + `translate3d(${(x - CX).toFixed(2)}px,${(y - CY).toFixed(2)}px,${z.toFixed(2)}px) rotateZ(${rz.toFixed(3)}deg) rotateY(${ry.toFixed(3)}deg) rotateX(${rx.toFixed(3)}deg) scale(${s.toFixed(4)})`;
      // blur flattens a preserve-3d wrapper (its face and back): only ever after the fan, when every card lies face-up
      c.wrap.style.filter = blur > 0.05 ? `blur(${blur.toFixed(2)}px) brightness(${(1 - dim).toFixed(3)})` : 'none';
      // paint order (pop-free): a card that has not yet turned past edge-on (still in the pile, or rising back-up)
      // lies above every card that has, lower index on top (the pile's top card is No. 1); once past edge-on, higher
      // index on top (each card lands on the one before). A pair therefore only swaps while the earlier card is a
      // sliver. The pulled card goes on top at the first edge-on of its flight — the next sliver.
      c.wrap.style.zIndex = String(i === p.hero && ry <= -90 ? 900 : ry > 90 ? 500 - i : 100 + i);
      // the card's shadow lies in its own plane: fade it as the card goes edge-on, or it smears into a parallelogram
      const c2 = Math.pow(Math.cos(ry * Math.PI / 180), 2);
      const bs = `${hand_K.RIM},0 18px 42px rgba(0,0,0,${(0.55 * c2).toFixed(3)})`;
      c.F.el.style.boxShadow = bs; c.Bk.el.style.boxShadow = bs;

      // the face prints itself once it turns up (u = card-local time) — B's order and curves, compressed
      const u = t - (ti + hand_K.PRINT);
      bandWipe(c.must, eo3(clamp(u / 0.26)), 'down');
      riseLinesFrame(c.name, u, 0.10);
      bandWipe(c.stripe, eo3(clamp((u - 0.16) / 0.22)), 'right');
      bandWipe(c.paper, eo3(clamp((u - 0.22) / 0.26)), 'up');
      c.kick.style.opacity = eo3(clamp((u - 0.30) / 0.30)).toFixed(3);
      fadeLinesFrame(c.role, u, 0.46, 0.08, 0.36);
      // the photo fades up from pale grey and rises 24 px, then stands off the card: it shifts in the card plane by
      // L·sin(view angle), clamped so its glued edges never come inside the card
      const cp = eo3(clamp((u - 0.20) / 0.42));
      const L = 14 + 46 * lift, ryv = ((ry % 360) + 540) % 360 - 180 + rigRy, rxv = rx + rigRx;
      const dx = clamp(L * Math.sin(ryv * Math.PI / 180), -M, M);
      const dy = clamp(-L * Math.sin(rxv * Math.PI / 180), -(M + c.dy) + 2, M) + (1 - cp) * 24;
      c.cut.el.style.opacity = clamp(cp * 1.4).toFixed(3);
      c.cut.el.style.transform = `translate3d(${dx.toFixed(2)}px,${dy.toFixed(2)}px,0)`;
      const so = lerp(11, 30, lift), sb = lerp(11, 26, lift);
      c.cut.img.style.filter = `grayscale(1) contrast(${lerp(0.4, 1.06, cp).toFixed(3)}) brightness(${lerp(1.5, 1, cp).toFixed(3)}) ` +
        `drop-shadow(${(so * 0.8).toFixed(1)}px ${so.toFixed(1)}px ${sb.toFixed(1)}px rgba(0,0,0,${lerp(0.36, 0.42, lift).toFixed(3)}))`;
    });

    // the side column: A's bars grow LEFT out from behind the landed card, the title rises out of them, then the text
    if (pulled) {
      p.bars.forEach((b, k) => bandWipe(b, eo3(clamp((t - T_REST - p.tBar - k * p.barStag) / p.barDur)), 'left'));
      riseLinesFrame(p.htitle, t, T_REST + p.tTitle);
      fadeLinesFrame(p.htext, t, T_REST + p.tText, 0.13, 0.42);
    } else { p.sideEl.style.display = 'none'; p.barsEl.style.display = 'none'; }

    // the camera: a 1.5 % push-in on the finished hand while it waits for the pull (about (960, 640)), then B's
    // ~1 % breathe over the hold (about (960, 540)); both smoothstep, composed into one scale + translate
    const s1 = pulled ? 1 + 0.015 * smooth((t - 1.4) / Math.max(0.3, T_PULL - 1.4)) : 1;          // no pull: only the breathe
    const s2 = 1 + 0.008 * smooth((t - (pulled ? T_REST : 2.2)) / Math.max(1e-3, D - (pulled ? T_REST : 2.2)));
    const s = s1 * s2, tx = 960 * (1 - s2) + s2 * 960 * (1 - s1), ty = 540 * (1 - s2) + s2 * 640 * (1 - s1);
    p.cam.style.transformOrigin = '0 0';
    p.cam.style.transform = s === 1 ? 'none' : `translate(${tx.toFixed(3)}px,${ty.toFixed(3)}px) scale(${s.toFixed(5)})`;
  },
};

/* tally.js — SCENES.tally: THE TALLY (ALMANAC template 3).
   The figure is too long for the frame, so the camera dollies along it at up to 2.4x while every digit is a printed
   cash-register drum that spins up out of the mask line (the bar's / band's bottom edge) and clunks to a stop as the
   camera passes. Then a smoothstep pull-back shows the whole number standing in reference A's bar next to a real
   cut-out (skin "page"), or on reference B's card with the object landing on the paper band (skin "card").

   S: { type:'tally', value | text, decimals, prefix, suffix, group (',' ; ' ' = narrow no-break space), point ('.'),
        skin ('page' when there is a portrait, else 'card'), camera ('auto' = dolly at >= 6 digits | 'dolly' | 'still'),
        page:  portrait (cut-out), portrait_x/y/h (-40 / 140 / 1000), edge (white keyline px, default 0), fig_x (800),
               headline (A's subtitle), source,
               footage {clips, fps 12, width 1280, focus_y .55, bright .8, credit} (archive film playing inside the bar;
               the bar's bitmap is Z0x its CSS size, so prep the clip at 1280 for the 2.4x dolly)
        card:  cutout (object cut-out), cutout_x/y/h (1330 / 440 / 560; y 150 when the figure is < 800 px wide: it
               lands IN the band), cutout_rot (-5; -8 narrow), kicker, headline, body, source. The rotated box is kept
               inside the card.
        tally_seed (7: the drums' step offsets; `seed` is reserved) }

   Geometry (Kit Sans 900, -.03em, tabular): digit 0.6145 em, ',' '.' 0.2386 em, '$' 0.655 em; a space inside the
   figure is a FIXED 0.26 em (a lone space measures 0 in nowrap). Every glyph sits in a drum window winH = 1.0875·F
   tall whose bottom edge is the mask line; the numeral's line box (line-height F) sits 0.0435·F inside it.
   Clock: the WHOLE scene reads almSharp(t) and moves in whole frames, as the references do. With the raw t a
   --shutter 3 render stacked every settled digit into three outlines during the dolly and the pull-back (measured on a
   zoomed render); the drums already carry their own motion blur (almDrum's vertical SVG blur).
   Camera blur is SYNTHETIC and pure in t: the dolly (up to 39 px/frame) puts a horizontal Gaussian on a lens div
   (σ = 0.2·px/frame, ≤ 8); the pull-back scales the page about the point the two framings share (pX, pY: the
   figure's end), so the figure's end stays put; the portrait (from its face's velocity) and every figure column (from
   its own velocity: the '$' enters at ~58 px/frame, the last digit moves 2) get their own horizontal blur (σ ≤ 12).
   Page opening: the camera opens on the face (prep's `face`), and the bar's grow runs across the visible 800 world px
   over A's 0.43 s.
   Helpers used from core: almCam, groundPage/groundCharcoal, makeCard/cardFinish/cardFrame, almFill, bandWipe, rise/
   riseFrame, fadeLines/fadeLinesFrame, cutout/cutoutFrame, almCut, almFootage, almDrum, almJolt, almRng, almBaseline,
   shutterBuild/shutter, smooth, ease3, almSharp, ALM_ENGRAVE.
   Local helpers (tally_*): the figure string, glyph advances, the static glyph, the one-line fit, the drum's empty
   start window (numerals stream up out of the mask line instead of popping in). */

// the figure as printed: prefix + grouped number + suffix (or a literal `text`)
function tally_text() {
  if (S.text != null && String(S.text) !== '') return String(S.prefix || '') + String(S.text) + String(S.suffix || '');
  const dec = Math.max(0, S.decimals | 0), v = Number(S.value || 0);
  let g = S.group == null ? ',' : String(S.group);
  if (g === ' ') g = '\u202F';                                   // Czech grouping: a narrow no-break space
  const pt = S.point == null ? '.' : String(S.point);
  const p = Math.abs(v).toFixed(dec).split('.');
  p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, () => g);
  return String(S.prefix || '') + (v < 0 ? '\u2212' : '') + p.join(pt) + String(S.suffix || '');
}
const tally_isSpace = c => /[\s\u00A0\u202F\u2009]/.test(c);
// the figure's style (drum faces and static glyphs share it)
function tally_style(F, ink, under) {
  return `font-family:${ALM.font};font-weight:900;font-size:${F}px;line-height:${F}px;letter-spacing:-0.03em;` +
    `font-feature-settings:'tnum' 1;white-space:pre;color:${ink}` +
    (under ? `;text-shadow:${(0.018 * F).toFixed(1)}px ${(0.012 * F).toFixed(1)}px 0 ${under}` : '');
}
// advance of every character in em (measured at 1000 px, letter-spacing included); spaces are a fixed 0.26 em
function tally_advances(chars) {
  const pr = document.createElement('span');
  pr.style.cssText = 'position:absolute;left:0;top:0;visibility:hidden;' + tally_style(1000, '#000');
  scene.appendChild(pr);
  const cache = {}, out = chars.map(c => {
    if (tally_isSpace(c)) return 0.26;
    if (cache[c] == null) { pr.textContent = c; cache[c] = pr.getBoundingClientRect().width / 1000; }
    return cache[c];
  });
  scene.removeChild(pr);
  return out;
}
// a static glyph ($, separators, suffix letters) in its own window: it rises once, out of the same mask line
function tally_glyph(host, ch, x, y, w, F, ink, under) {
  const el = document.createElement('div'); el.className = 'alm-drum';
  el.style.cssText = `left:${almPx(x)};top:${almPx(y)};width:${almPx(w)};height:${almPx(1.0875 * F)}`;
  const g = document.createElement('div'); g.className = 'alm-num';
  g.style.cssText += ';' + tally_style(F, ink, under);
  g.textContent = ch; el.appendChild(g); host.appendChild(el);
  return { el, g };
}
// the largest size (big → small, 0.5 px steps) at which a one-line string fits maxW
function tally_fit(text, big, small, weight, maxW, ls) {
  const pr = document.createElement('span');
  pr.style.cssText = `position:absolute;left:0;top:0;visibility:hidden;white-space:nowrap;font-family:${ALM.font};font-weight:${weight};letter-spacing:${ls || 0}em`;
  pr.textContent = String(text || ''); scene.appendChild(pr);
  let s = big; pr.style.fontSize = s + 'px';
  while (s > small && pr.getBoundingClientRect().width > maxW) { s -= 0.5; pr.style.fontSize = s + 'px'; }
  scene.removeChild(pr);
  return s;
}
// a small caps line (the source credit). 17 → 13 px to fit one line (15 px #9A9A9A was 2.8:1 and broke up after
// compression); a line that still overflows at 13 px wraps at maxW instead of running off the page. Returns the
// element with .rows (1 or 2) so the caller can budget the space.
function tally_label(host, text, x, y, color, maxW) {
  const d = document.createElement('div'); d.className = 'abs';
  // caps in JS, not CSS: a case name keeps its lower-case "v." ("U.S. v. CAPONE"), as register.js sets it
  const caps = String(text).split(/(\s+)/).map(w => /^v\.?$/i.test(w) ? 'v.' : w.toUpperCase()).join('');
  const size = tally_fit(caps, 17, 13, 700, maxW, 0.16);
  d.style.cssText = `left:${almPx(x)};top:${almPx(y)};font-family:${ALM.font};font-weight:700;font-size:${size}px;line-height:1.25;` +
    `letter-spacing:.16em;color:${color};white-space:nowrap;opacity:0`;
  d.textContent = caps; host.appendChild(d);
  d.rows = 1;
  if (d.getBoundingClientRect().width > maxW + 1) {
    d.style.whiteSpace = 'normal'; d.style.width = almPx(maxW);
    d.rows = Math.max(1, Math.round(d.getBoundingClientRect().height / (1.25 * size)));
  }
  return d;
}
// the dolly's zoom for a figure of size F: the numerals' cap height fills ~480 px on screen (1.5x–2.4x)
const tally_Z0 = (F, dolly) => dolly ? clamp(480 / (0.7275 * F), 1.5, 2.4) : 1;
// a horizontal/vertical Gaussian blur we can steer per frame (synthetic motion blur: the scene runs on almSharp, so
// the renderer's shutter cannot blur it; a blur computed from the camera's own velocity is still pure in t)
function tally_blur(id, region) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '0'); svg.setAttribute('height', '0'); svg.style.position = 'absolute';
  svg.innerHTML = `<defs><filter id="${id}" ${region} color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="0 0"/></filter></defs>`;
  scene.appendChild(svg);
  const fe = svg.querySelector('feGaussianBlur');
  let last = '';
  return (sx, sy) => {                                   // returns the CSS filter token ('' = off)
    if (sx < 0.4 && sy < 0.4) return '';
    const v = `${sx < 0.4 ? 0 : sx.toFixed(2)} ${sy < 0.4 ? 0 : sy.toFixed(2)}`;
    if (v !== last) { fe.setAttribute('stdDeviation', v); last = v; }
    return `url(#${id})`;
  };
}

SCENES.tally = {
  build() {
    const card = (S.skin || (S.portrait ? 'page' : 'card')) === 'card';
    const txt = tally_text(), chars = [...txt], adv = tally_advances(chars);
    const emW = adv.reduce((a, b) => a + b, 0) || 1;
    const nDig = chars.filter(c => /\d/.test(c)).length;
    const camMode = S.camera || 'auto';
    const dolly = camMode === 'dolly' || (camMode === 'auto' && nDig >= 6 && D >= 6.0);
    // lens (no transform: carries the dolly's motion blur) → world (the camera transform)
    const lens = almCam(), world = almCam(lens); world.style.transformOrigin = '0 0';
    const P0 = { card, dolly, lens, world, txt, lensBlur: tally_blur('tally-mb', 'x="-3%" y="0" width="106%" height="100%"') };
    let X0, F, winTop, host, ox = 0, oy = 0, ink, under;

    if (!card) {
      /* ── page skin: reference A ─────────────────────────────────────────────────────────── */
      groundPage();
      X0 = S.fig_x == null ? 800 : +S.fig_x; const XR = 1860;
      F = Math.min(300, (XR - X0) / emW);
      const winH = 1.0875 * F, barTop = 548.5 - winH / 2, barBot = barTop + winH, Zf = tally_Z0(F, dolly);
      winTop = barTop; ink = ALM.yellow; under = null;
      const bar = almFill(world, 0, barTop, W, winH, ALM.bar);
      bar.style.overflow = 'hidden';
      // archive film inside the bar: cover-fit at focus_y, the style's grade, darker, under a flat bar veil. The bitmap
      // is Zf times the CSS size, so the camera's 2.4x does not upscale it a second time (it was 7.2x in total)
      const fo = S.footage && typeof S.footage === 'object' ? S.footage : null;
      if (fo && (fo.frames || []).length) {
        const film = almFootage(fo), cv = document.createElement('canvas');
        cv.width = Math.ceil(W * Zf); cv.height = Math.ceil(winH * Zf);
        cv.style.cssText = `position:absolute;left:0;top:0;width:${W}px;height:${almPx(Math.ceil(winH))}`;
        bar.appendChild(cv);
        Object.assign(P0, { film, filmCtx: cv.getContext('2d'), filmFi: -1, filmO: {
          focusY: fo.focus_y == null ? 0.55 : +fo.focus_y, bright: fo.bright == null ? 0.8 : +fo.bright,
          veil: { color: ALM.bar, a: 0.5 } } });
      }
      // the portrait: B&W, cut by the frame bottom, IN FRONT of the bar (A's grammar). The grey filters stay on the
      // img; the white rim and the shadow go on the box (set per frame: the rim is 2/z px so it stays 2 px on screen
      // at 2.4x), so a mask on the img can never clip the shadow into a straight lid.
      let por = null;
      if (S.portrait) {
        // the slot is sized for a standing person (h 1000, w = h·ar): their shoulder may cross the bar in front of the
        // first digit, as A's suit does. A WIDE picture (ar > 1.05: an object, someone at a desk) is solid to its
        // edge and would cover the figure's first digits, so its width is held to the room left of the figure
        // (40 px clear) and it shrinks, standing ON the frame's bottom edge (a car cut at its wheels reads as a mistake)
        const meta = almCut(S.portrait), px = S.portrait_x == null ? -40 : +S.portrait_x;
        let ph = S.portrait_h == null ? 1000 : +S.portrait_h, py = S.portrait_y == null ? 140 : +S.portrait_y;
        const room = X0 - 40 - px;
        if (meta.ar > 1.05 && ph * meta.ar > room && room > 200) { ph *= room / (ph * meta.ar); py = H - ph; }
        const pw = ph * meta.ar;
        por = cutout(world, S.portrait, {
          x: px, y: py, w: pw, h: ph,
          pos: '0% 100%', bw: true, shadow: false, origin: '30% 60%',
        });
        por.el.style.willChange = 'auto';                    // re-rasterise with the camera (sharp at 2.4x)
        por.base = por.img.style.filter;                     // grayscale + contrast
        por.blur = tally_blur('tally-pmb', 'x="-12%" y="-12%" width="124%" height="124%"');
        por.face = [por.x + meta.face[0] * pw, por.y + meta.face[1] * ph];
        // a side the photo's frame cut (prep `edges`) that faces the figure dissolves instead of ending in a
        // straight line (the same rule as bar.js). The shipped 1931 cut-out has its shoulder restored, so it no
        // longer needs this; other photos may.
        if (meta.edges.includes('r')) {
          const g = `linear-gradient(to right,#000 ${almPx(pw - 140)},transparent ${almPx(pw - 2)})`;
          por.img.style.webkitMaskImage = g; por.img.style.maskImage = g;
        }
      }
      host = document.createElement('div'); host.className = 'abs'; host.style.cssText = 'left:0;top:0'; world.appendChild(host);
      // A's subtitle: fitted 40 → 30 px on one line, else two lines at most; then the source line under it
      const hs = tally_fit(S.headline || '', 40, 30, 700, XR - X0);
      const sub = fadeLines(world, S.headline || '', { x: X0 + 4, baseline: barBot + 50, w: XR - X0 + 12, size: hs, weight: 700, lh: 48, color: ALM.sub });
      sub.lines.forEach((l, k) => { if (k >= 2) l.style.display = 'none'; });
      const nl = Math.max(1, Math.min(2, sub.lines.length));
      const line = [S.source ? 'Source: ' + S.source : '', fo && fo.credit ? 'Film: ' + fo.credit : ''].filter(Boolean).join(' · ');
      const src = line ? tally_label(world, line, X0 + 6, barBot + 72 + (nl - 1) * 48, '#767676', XR - X0 - 6) : null;
      shutterBuild(scene);                                   // on top of everything, outside the camera
      Object.assign(P0, { bar, por, sub, src, barTop, barBot });
    } else {
      /* ── card skin: reference B ─────────────────────────────────────────────────────────── */
      groundCharcoal();
      X0 = 190;
      F = Math.min(276, 1540 / emW);
      winTop = 484 - 1.0875 * F; ink = ALM.ink; under = ALM.cream;
      const C = makeCard({ parent: world });                 // inner 145–1775 x 97–983
      ox = C.ix; oy = C.iy;
      const BAND = 484 - C.iy, PAPER = 581 - C.iy;
      almFill(C.inner, 0, BAND, C.iw, PAPER - BAND, ALM.stripe);
      const paper = almFill(C.inner, 0, PAPER, C.iw, C.ih - PAPER, ALM.paperStock);
      const band = almFill(C.inner, 0, 0, C.iw, BAND, ALM.mustard);
      const rule = almFill(C.inner, 0, winTop - 7 - oy, C.iw, 7, ALM.ink);
      const kick = rise(C.inner, String(S.kicker || '').toUpperCase(), {
        x: 49, baseline: (winTop - 30) - oy, size: 34, weight: 800, ls: 0.12, color: ALM.ink });
      host = C.inner;
      // a figure that leaves most of the band empty (< 800 px, e.g. a lone "0") gets the object landing IN the band,
      // over band and stripe as B's engine does, instead of low on the paper band
      const narrow = emW * F < 800;
      const cx_ = S.cutout_x == null ? 1330 : +S.cutout_x;
      // the paper-band text stops 60 px short of the object so the landing never covers a word
      const tw = S.cutout ? Math.max(600, Math.min(1150, cx_ - 60 - X0)) : 1150;
      const hb = (620 - oy) + almBaseline(56, 800);
      const head = rise(C.inner, S.headline || '', { x: X0 - ox, baseline: hb, size: 56, weight: 800, ls: -0.012,
        color: ALM.ink, maxW: tw, maskY: hb + 0.26 * 56 });
      const body = fadeLines(C.inner, S.body || '', { x: X0 - ox, y: 690 - oy, w: tw, size: 30, weight: 500, lh: 44,
        color: ALM.engraved, shadow: ALM_ENGRAVE });
      body.lines.forEach((l, k) => { if (k >= 3) l.style.display = 'none'; });   // three lines at most
      const nb = Math.min(3, body.lines.length);
      const src = S.source ? tally_label(C.inner, 'Source: ' + S.source, X0 - ox, 690 - oy + nb * 44 + 18, '#7A766F', tw) : null;
      P0.C = C; P0.band = band; P0.paper = paper; P0.rule = rule; P0.kick = kick; P0.head = head; P0.body = body; P0.src = src;
      // the object lands above the card and its texture (B's engine is clean). Its ROTATED box is kept inside the
      // card's inner rect (14 px margin): the defaults used to push the IRS letter 44 px past the right border
      if (S.cutout) {
        const meta = almCut(S.cutout);
        let oh = S.cutout_h == null ? 560 : +S.cutout_h;
        const rot = S.cutout_rot == null ? (narrow ? -8 : -5) : +S.cutout_rot, ra = Math.abs(rot) * Math.PI / 180;
        const IN = [145 + 14, 97 + 14, 1775 - 14, 983 - 14];
        const rw = h => (h * meta.ar * Math.cos(ra) + h * Math.sin(ra)), rh = h => (h * meta.ar * Math.sin(ra) + h * Math.cos(ra));
        oh = Math.min(oh, oh * (IN[2] - IN[0]) / rw(oh), oh * (IN[3] - IN[1]) / rh(oh));
        const ow = oh * meta.ar;
        let x = cx_, y = S.cutout_y == null ? (narrow ? 150 : 440) : +S.cutout_y;
        let ccx = clamp(x + ow / 2, IN[0] + rw(oh) / 2, IN[2] - rw(oh) / 2), ccy = clamp(y + oh / 2, IN[1] + rh(oh) / 2, IN[3] - rh(oh) / 2);
        P0.obj = cutout(world, S.cutout, { x: ccx - ow / 2, y: ccy - oh / 2, w: ow, h: oh, rot, shadow: { x: 12, y: 10, blur: 16, a: 0.5 } });
        P0.obj.el.style.willChange = 'auto';
      }
    }

    /* ── the figure: one drum per digit, a rising window per static glyph ─────────────────── */
    const winH = 1.0875 * F, rng = almRng(S.tally_seed == null ? 7 : +S.tally_seed);
    const cols = []; let x = X0;
    chars.forEach((c, i) => {
      const w = adv[i] * F;
      if (tally_isSpace(c)) { x += w; return; }
      const ww = w + Math.ceil(0.03 * F) + 6;
      if (/\d/.test(c)) {
        const drum = almDrum(host, { x: x - ox, y: winTop - oy, w: ww, F, ink, under });
        drum.el.style.visibility = 'hidden';
        const steps = 6 + Math.floor(rng() * 5);
        cols.push({ dig: true, drum, d: +c, steps, s0: +c - steps, x, cx: x + w / 2, w });
      } else {
        const gl = tally_glyph(host, c, x - ox, winTop - oy, ww, F, ink, under);
        gl.el.style.visibility = 'hidden';
        cols.push({ dig: false, gl, ch: c, x, cx: x + w / 2, w });
      }
      x += w;
    });
    if (card) cardFinish(P0.C, { grain: 2.2, grainRect: [0, 581 - oy, P0.C.iw, P0.C.ih - (581 - oy)] });   // texture ABOVE the digits

    /* ── the camera and the ring-up schedule (pure, solved once) ──────────────────────────── */
    const R = 0.62;
    const Z0 = tally_Z0(F, dolly), vw = W / Z0;
    const dig = cols.filter(c => c.dig);
    // aim at the last glyph, not the last digit: a suffix (" dolarů") must rise where the camera looks
    const xLast = Math.max(X0, ...cols.map(c => c.cx));
    // page: open on the FACE (its centre 0.40 vw left of frame centre: eyes, mouth and the '$' in one frame), not on
    // the ear. Reference A's shutter reveals the man.
    const pf = !card && P0.por ? P0.por.face : null;
    const cx0 = card ? 145 + vw / 2 : (pf && dolly ? Math.max(vw / 2, pf[0] + 0.40 * vw) : X0 - 0.30 * vw + vw / 2);
    const cx1 = Math.max(cx0, Math.min(W - vw / 2, xLast - 0.20 * vw));
    const T0 = card ? 0.35 : 0.55, T1 = card ? Math.min(3.0, 0.43 * D) : Math.min(3.1, 0.44 * D);
    const camX = t => lerp(cx0, cx1, smooth(seg(t, T0, T1)));
    const cy0 = card ? (winTop - 80 + 484 + 60) / 2 : (P0.barTop + P0.barBot) / 2 + 20;
    const mMin = card ? 0.62 : 0.85;
    // a column rings up as the camera's lead point (0.22 vw right of centre) reaches it. Columns the lead point never
    // reaches (the camera stops at the page edge) used to fall to the T1 clamp and to prev + 0.10, a 0.58 / 0.10
    // stutter; they now follow the column before at an even 0.20 s (less if the scene is short), but never start
    // before the whole window is inside the view (30 px margin)
    const lead = t => camX(t) + 0.22 * vw;
    const inView = c => { let lo = 0, hi = T1;
      for (let it = 0; it < 40; it++) { const mid = (lo + hi) / 2; if (camX(mid) + vw / 2 - 30 < c.x + c.w) lo = mid; else hi = mid; }
      return hi; };
    const pinned = dolly ? dig.filter(c => lead(T1) < c.cx).length : 0;
    const sp = pinned > 1 ? clamp((D - 2.83 - T1) / (pinned - 1), 0.10, 0.20) : 0.20;
    let prev = -1e9;
    dig.forEach((c, j) => {
      let m;
      if (dolly) {
        if (lead(T1) < c.cx) m = Math.max(mMin, prev + sp, inView(c) + R / 2);
        else {
          let lo = 0, hi = T1;
          for (let it = 0; it < 40; it++) { const mid = (lo + hi) / 2; if (lead(mid) < c.cx) lo = mid; else hi = mid; }
          m = Math.max((lo + hi) / 2, mMin, prev + 0.10);
        }
      } else m = (card ? 0.75 : 0.95) + 0.07 * j;
      prev = m; c.a = m - R / 2; c.b = m + R / 2;
    });
    // static glyphs: a leading one rises just BEFORE the first drum ($ never after a lone spinning drum), a separator
    // when the column to its left settles (b − 0.05), and a run of letters (a suffix) follows at 25 letters/s
    cols.forEach((c, k) => {
      if (c.dig) return;
      const L = k > 0 ? cols[k - 1] : null;
      c.rise = !L ? Math.min(card ? 0.45 : 0.62, (dig.length ? dig[0].a : 9) - 0.06) : L.dig ? L.b - 0.05 : L.rise + 0.04;
    });
    const lastB = Math.max(0, ...cols.map(c => c.dig ? c.b : c.rise + 0.2));
    // the pull-back: 1.4 s (1.1 strobed at up to 111 px/frame), shortened toward 1.0 s only to keep the text still
    // for >= 1.25 s after the source line lands
    const Zs = dolly ? Math.max(T1, lastB) + 0.22 : lastB + 0.1;
    const Ze = dolly ? Zs + clamp(D - 1.65 - Zs, 1.0, 1.4) : Zs;
    // each column gets its own horizontal blur for the pull-back: the page scales about the figure's END, so the '$'
    // enters at ~58 px/frame while the last digit moves 2 — one blur for the whole figure would be wrong
    if (dolly) cols.forEach((c, j) => { c.blur = tally_blur('tally-cb' + j, 'x="-40%" y="0" width="180%" height="100%"'); });
    const bs = dig.map(c => c.b);
    // zoom about the one point both framings share (the dolly's last framing at Z0 and the page at 1x), so every
    // point travels straight and monotonically: the figure's end no longer swings out to the frame edge and back
    const pX = Z0 > 1.001 ? (cx1 * Z0 - 960) / (Z0 - 1) : 960, pY = Z0 > 1.001 ? (cy0 * Z0 - 540) / (Z0 - 1) : 540;
    const k = card ? 0.02 : 0.012;
    const cam = t => {
      if (!dolly) return { z: 1 + 0.03 * smooth(seg(t, 0, D)), cx: 960, cy: 540, q: 0 };
      const q = smooth(seg(t, Zs, Ze)), zp = Math.pow(Z0, 1 - q);
      return { q, z: zp * (1 + k * smooth(seg(t, Ze, D))),
        cx: q > 0 ? pX - (pX - 960) / zp : camX(t), cy: q > 0 ? pY - (pY - 540) / zp : cy0 };
    };
    Object.assign(P0, { cols, F, winH, R, Z0, vw, camX, cam, cx0, cx1, T0, T1, cy0, Zs, Ze, bs, pX, pY, k });
    parts = P0;
  },

  frame(t) {
    const p = parts, ts = almSharp(t);
    t = ts;                                                              // whole frames everywhere (see the header)

    /* camera: dolly → pull-back → breath (smoothstep everywhere; z geometric about the shared point) */
    const c0 = p.cam(t), c1 = p.cam(t + 1 / ALM.fps), z = c0.z, q = c0.q;
    const jolt = almJolt(t, p.bs, 3.2, 9, 14) * (1 - 0.7 * q);
    p.world.style.transform = `translate(${(960 - c0.cx * z).toFixed(2)}px,${(540 - c0.cy * z + jolt).toFixed(2)}px) scale(${z.toFixed(5)})`;
    // synthetic motion blur. Dolly (z constant, the whole page translates): a horizontal lens blur from the camera's
    // speed, σ = 0.2 · px/frame, at most 8. Pull-back: the page scales about (pX, pY) near the figure's end, so the
    // figure barely moves and the portrait moves most; the portrait alone gets a blur from its face's velocity.
    const sp = (wx, wy, c) => [960 + (wx - c.cx) * c.z, 540 + (wy - c.cy) * c.z];
    const lv = p.dolly && q === 0 && c1.q === 0 ? Math.abs(c1.cx - c0.cx) * z : 0;
    p.lens.style.filter = p.lensBlur(Math.min(8, 0.2 * lv), 0) || 'none';

    /* the figure */
    const pull = p.dolly && q < 1 && q + c1.q > 0;
    for (const c of p.cols) {
      if (c.blur) {
        const v = pull ? Math.abs((c.cx - c1.cx) * c1.z - (c.cx - c0.cx) * z) : 0, f = c.blur(Math.min(12, 0.15 * v), 0);
        (c.dig ? c.drum.el : c.gl.el).style.filter = f || 'none';
      }
      if (c.dig) {
        const pr = seg(t, c.a, c.b), pos = c.s0 + c.steps * eo3(pr);
        const speed = pr > 0 && pr < 1 ? c.steps * 3 * Math.pow(1 - pr, 2) / p.R : 0;
        const tau = t - c.b, kick = tau > 0 ? -0.07 * Math.sin(2 * Math.PI * 6.5 * tau) * Math.exp(-15 * tau) : 0;
        c.drum.el.style.visibility = t < c.a ? 'hidden' : 'visible';
        c.drum.set(pos, speed, kick);
        // the window starts EMPTY: numerals at or above the start position are blank, so the first numeral streams
        // up out of the mask line instead of popping in
        const b0 = Math.floor(pos);
        c.drum.faces.forEach((f, k) => { if (b0 + k - 1 <= c.s0 && f.textContent !== '') f.textContent = ''; });
      } else {
        const u = seg(ts, c.rise, c.rise + 0.2);
        c.gl.el.style.visibility = u > 0 ? 'visible' : 'hidden';
        c.gl.g.style.transform = `translate3d(0,${(0.0435 * p.F + (1 - eback(u)) * 1.02 * p.winH).toFixed(2)}px,0)`;
      }
    }

    if (!p.card) {
      shutter(ts);                                                        // A's opening, 0 → 0.6 s
      // the bar grows from the right edge. Dollying, the wipe runs across what the camera SEES (right edge of the
      // view → just past its left edge) over A's 0.43 s, so it reads as A's grow instead of a 2-frame pop; the rest
      // of the page's bar completes off camera
      if (p.dolly) {
        const pS = (W - (p.cx0 + p.vw / 2) - 4) / W, pE = (W - (p.cx0 - p.vw / 2)) / W + 0.06;
        bandWipe(p.bar, ts < 0.95 ? lerp(pS, pE, ease3(ts, 0.38, 0.43)) : 1, 'left');
      } else bandWipe(p.bar, ease3(ts, 0.38, 0.28), 'left');
      if (p.film) {
        const fi = p.film.idx(t, 0.38);
        if (fi !== p.filmFi) { p.filmCtx.clearRect(0, 0, p.filmCtx.canvas.width, p.filmCtx.canvas.height);
          p.film.draw(p.filmCtx, fi, 0, 0, p.filmCtx.canvas.width, p.filmCtx.canvas.height, p.filmO); p.filmFi = fi; }
      }
      if (p.por) {
        cutoutFrame(p.por, ts, { t0: 0.16, dur: 0.42, fade0: 0.20, fade: 0.26, drift: { t0: p.Ze, t1: D, ds: 0.02 } });
        const b = 1 + 0.9 * (1 - eo3(seg(ts, 0.16, 0.58)));             // fades up from pale
        p.por.img.style.filter = (b > 1.0005 ? `brightness(${b.toFixed(4)}) ` : '') + p.por.base;
        // S.edge: an optional white keyline (screen px, kept constant through the zoom). Default 0: the 2 px rim
        // read as a sticker next to reference A, which has none where the suit crosses the bar
        const ek = S.edge == null ? 0 : +S.edge, e = (ek / z).toFixed(2), f0 = sp(p.por.face[0], p.por.face[1], c0), f1 = sp(p.por.face[0], p.por.face[1], c1);
        const mb = p.dolly && q + c1.q > 0 ? p.por.blur(Math.min(12, 0.15 * Math.abs(f1[0] - f0[0])), Math.min(12, 0.15 * Math.abs(f1[1] - f0[1]))) : '';
        p.por.el.style.filter = (ek > 0 ? `drop-shadow(${e}px 0 0 #fff) drop-shadow(-${e}px 0 0 #fff) drop-shadow(0 ${e}px 0 #fff) ` +
          `drop-shadow(0 -${e}px 0 #fff) ` : '') + `drop-shadow(22px 10px 26px rgba(0,0,0,.34))` + (mb ? ' ' + mb : '');
      }
      // A's subtitle (pale → black) and the source: they arrive as the pull-back settles, so they never strobe
      const s0 = p.dolly ? p.Ze - 0.25 : p.Zs + 0.55;
      fadeLinesFrame(p.sub, ts, s0, 0, 0.40, 3);
      if (p.src) p.src.style.opacity = seg(ts, s0 + 0.30, s0 + 0.60).toFixed(4);
    } else {
      // still mode has no dolly to wait for: the paper band follows the figure at once (B's paper arrives at 0.73 s),
      // so the lower half of the card is not a black void for 1.4 s
      const o = p.dolly ? 0 : -0.40;
      cardFrame(p.C, ts, 0);                                              // the card pops (at 2.4x when dollying)
      bandWipe(p.band, ease3(ts, 0.04, 0.26), 'down');                    // mustard down to the mask line
      bandWipe(p.rule, ease3(ts, 0.22, 0.33), 'right');                   // the ink rule over the windows
      riseFrame(p.kick, ts, 0.30, 25);
      bandWipe(p.paper, ease3(ts, p.Zs + 0.55 + o, 0.40), 'up');          // paper up from the card bottom
      if (p.obj) cutoutFrame(p.obj, ts, { t0: p.Zs + 0.72 + o, dur: 0.26, dx: 160, dy: 130, rot0: -15, s0: 1.12,
        fade0: p.Zs + 0.72 + o, fade: 0.28, settle: { t0: p.Zs + 0.90 + o, dur: 0.7, dx: -4, dy: -6 } });
      riseFrame(p.head, ts, p.Zs + 0.95 + o, 25);
      fadeLinesFrame(p.body, ts, p.Zs + 1.15 + o, 0.12, 0.42, 2);
      if (p.src) p.src.style.opacity = seg(ts, p.Zs + 1.5 + o, p.Zs + 1.8 + o).toFixed(4);
    }
  },
};

/* cardwall.js — SCENES.cardwall: the CARD WALL (ALMANAC template 4).
   Real archive film plays full-frame, then CRACKS into a wall of collector cards (default 5 x 3) on charcoal, each
   printed with a cream margin inside its black edge like a 1930s cigarette card. A diagonal wave FLIPS them over in
   3D: each card lifts, turns, and slaps down, its shadow widening and snapping tight. Their backs are slices of one
   ALMANAC card, so the portrait assembles across the tiles — the face whole in ONE tile (the grid bends around it).
   The gutters slide shut, the tiles fuse into ONE reference-B card, the black frame clamps on, the title rises
   behind the photo, the photo peels off the page and the engraved paragraph fades in. Then it breathes.

   S: { type:'cardwall',
        footage  {clips, fps 15, width 1280, focus_y .45, grade 'mono'} (almanac_prep turns clips into frames), or
        image    a still instead of film (a newspaper page ...),
        split_at s the film plays full-frame this long before it cracks (default .25; .8+ opens on its own film),
        grid     [cols, rows] (default [5, 3]; [4, 3] and [6, 4] work; the face-aware grid may drop a cell),
        title    one line, <= 10 characters with a face (5–6 reads as reference B: 340 px type; a longer title
                 shrinks, and one under 200 px type with two or more words sets on TWO rows; console.warn below 200),
        cutout   a PNG with alpha (the prep adds ar, face [cx, cy, fh], edges, top),
        face_tile [c, r]     the tile whose middle the face aims for (default [3, 0]),
        title_tuck           share of the title's last letter the head may cover (default .5, a digit .3; a date
                             wants ~.05),
        stripe_label         small mustard caps on the stripe (optional; also the place for a photo credit),
        body     <= 180 characters (a longer one is cut at the last word that fits, with '…', and a console.warn) }

   Geometry: the fused card is a real makeCard() with card.js's layout (card 134–1786 x 86–994, inner R = 145, 97,
   1630 x 886; mustard to 388.5, stripe 388.5–484.5, paper below, B's texture and inner shade), so the end frame IS
   the reference card. makeCard's own background and shadow are switched off: a separate RING (an SVG path whose
   hole has makeCard's 64 px inner radius, plus makeCard's outer shadow and rim) clamps on instead, so the wall
   shows through until the frame lands. At s0 = max(1920/1630, 1080/886) = 1.219 the wall covers the frame, so
   t = 0 is plain full-frame film (drawn by ONE cover canvas, so there is no tile edge anywhere until the crack).

   The grid is FACE-AWARE (cardwall_axis): it starts even (round(c·1630/cols), round(r·886/rows)); every edge that
   would cross the face's keep-out K = [fcx ± .42 fh] x [fcy − .40 fh, fcy + .32 fh] moves out of it, the face
   gets one hero tile (widened to the card edge if the leftover would be under ~220 px) and the other cells are
   spread evenly over what is left. So no gutter ever crosses the eyes, nose or mouth while the face assembles.

   Timeline (Δ = split_at − 0.25; every beat after the crack shifts by Δ; constants in cardwall_T):
     0 → split_at                  full-frame film
     split_at → +0.70              the crack: scale s0 → 1, gutter 0 → 26, cream margin 0 → 9 (smooth, so the crack
                                   reads dark first); border 0 → 5, radius 0 → 12, seeded rotZ ±1.6°, tile shadows 0 → .45, card stock 0 → .3 (eo3)
     0.85+Δ + stag·(c+r) ± .025    the flip wave, 0.62 s per tile: the turn eases in from rest and LANDS at speed
                                   at q .72 (a = 180·x²(2−x)); the lift follows the angle (z 90·sin a, scale
                                   1 + .06·sin a, highest edge-on); then the slap (q .72–1): z dips 5 px, scale
                                   −1.2 %, the shadow snaps tight. The turn runs on the RAW t, so shutter 3 blurs it.
                                   stag = .085, less on big grids so the wave lands by ~1.9+Δ
     1.90+Δ → 2.30+Δ               the fuse: gutter, border, margin, rotZ → 0, inner radii → 0, the four OUTER
                                   corners → 64 px (the ring's hole), so no square corner ever shows (smooth)
     2.25+Δ                        the ring clamps: opacity 0 → 1 in .10 s, scale 1.035 → 1 over .30 s (eback)
     2.27+Δ →                      a flat FLOOR (the fused picture, one rounded 2D canvas) under the wall: the 1 px
                                   seams 3D-rasterised tiles keep at g = 0 show the picture instead of the charcoal
     2.30+Δ → 2.40+Δ               the swap: the real card cross-fades in over the wall; the wall is hidden after
     2.45+Δ →                      title rises (riseFrame, 18.9 letters/s) behind the photo
     2.95+Δ → 3.45+Δ               the photo lifts (almLift: shadow 18/28/36/.42, scale 1.03 about its foot, x −8)
     3.20+Δ → 3.60+Δ               stripe label fades in (only when given)
     3.35+Δ →                      body lines (fadeLinesFrame .08 / .42)
     2.55+Δ → D                    breathe 1 % (card.js's amount)
   While the wave runs nothing else moves. Minimum D ≈ 5.1 + Δ. Everything but the turn runs on almSharp(t).

   Photo placement — by the face, never by a box (cardwall_place): the face centre aims for the middle of face_tile,
   the photo is sized so its bottom bleeds 40 px under the card and is cut. Then three guards, in this order:
     1. the head stays inside the card at the top (24 px, counting the lift);
     2. the head (Vision's face box, square in pixels) stays 24 px inside the card's sides;
     3. a side the photo was CUT by its frame ('l'/'r' in edges) bleeds off the card when the head allows it.
   A side that was cut by its frame but cannot bleed is VIGNETTED (56 px fade to the paper), the way 1920s papers
   printed halftone portraits, on the card (CSS mask), the backs and the floor (destination-in), so no straight
   frame-cut floats in the paper band.
   Title fit: once the cut-out has decoded, the real silhouette is read from its alpha on the title's rows and the
   title is re-fitted so the head, where it lands after the lift, covers about half of its LAST letter. The
   paragraph is re-wrapped the same way to stay 36 px clear of the lifted photo. The renderer is held until done.

   Core helpers used: groundCharcoal almCam makeCard cardFinish almFill rise riseFrame riseLines riseLinesFrame
   fadeLines fadeLinesFrame cutout almCut almSrc almLift almFootage almHoldReady almSharp smooth breathe almRng.
   Helpers of this file (cardwall_*): T (timeline), turn (the flip curve), rrect (SVG path), place (the photo),
   axis (one axis of the face-aware grid), vignette, alphaLeft (silhouette edge from alpha), lifted (x after the
   peel), measure / title (the fit, one or two rows), body (paragraph + widow fix + safe cut). */

// the timeline, in seconds after the crack's shift Δ (see the header)
const cardwall_T = { flip: 0.62, land: 0.72, fuse0: 1.90, fuseDur: 0.40, ring0: 2.25, swap0: 2.30, swapDur: 0.10,
  title0: 2.45, lift0: 2.95, label0: 3.20, body0: 3.35, breathe0: 2.55, gutter: 26, tilt: 1.6, margin: 9 };

// the turn, 0 → 1 over x in [0, 1]: eases in from rest (the first frame moves ~2°, not 38°), peaks at 4/3 of its
// average speed and reaches 1 at its AVERAGE speed, so the card comes down onto the table instead of floating in
function cardwall_turn(x) { x = clamp(x); return x * x * (2 - x); }

// an SVG rounded-rectangle path
function cardwall_rrect(x, y, w, h, r) {
  return `M${x + r},${y}H${x + w - r}A${r},${r} 0 0 1 ${x + w},${y + r}V${y + h - r}A${r},${r} 0 0 1 ${x + w - r},${y + h}` +
    `H${x + r}A${r},${r} 0 0 1 ${x},${y + h - r}V${y + r}A${r},${r} 0 0 1 ${x + r},${y}Z`;
}

// where the cut-out goes, in the card's INNER coordinates (see the header): {x, y, w, h, fcx, fcy, fh, guards}
function cardwall_place(raw, iw, ih, xs, ys, ft) {
  const m = almCut(raw), M = 24, BLEED = 40;
  const fx = m.face[0], fy = m.face[1], fh = m.face[2], ar = m.ar, top = (raw && typeof raw === 'object' && +raw.top) || 0;
  const guards = [];
  let fcx = (xs[ft[0]] + xs[ft[0] + 1]) / 2, fcy = (ys[ft[1]] + ys[ft[1] + 1]) / 2;
  let h = Math.max((ih + BLEED - fcy) / (1 - fy), 600);                         // the spec's formula
  // 1. the crown stays inside the card, also once the lift (scale 1.03 about the foot) has raised it
  const foot = ih + BLEED, crownMin = (M + 0.03 * foot) / 1.03;
  if (fcy - (fy - top) * h < crownMin) {
    h = Math.max(600, (foot - crownMin) / (1 - top));
    fcy = foot - h + fy * h; guards.push('top');
  }
  const w = h * ar, half = 0.5 * fh * h;                                        // face box: square in pixels
  // 2. the head stays inside the card's sides
  let lo = M + half, hi = iw - M - half;
  if (lo > hi) lo = hi = iw / 2;
  const aim = fcx;
  if (fcx < lo || fcx > hi) { fcx = clamp(fcx, lo, hi); guards.push('side'); }
  // 3. a side cut by the photo's frame bleeds off the card if the head allows (prefer the side nearer the aim)
  const needR = iw + 8 - (1 - fx) * w, needL = fx * w - 8;                     // fcx >= needR | fcx <= needL
  const okR = m.edges.includes('r') && needR <= hi, okL = m.edges.includes('l') && needL >= lo;
  if (okR && (!okL || aim >= iw / 2)) { if (fcx < needR) { fcx = needR; guards.push('bleed-r'); } }
  else if (okL) { if (fcx > needL) { fcx = needL; guards.push('bleed-l'); } }
  const x = fcx - fx * w, y = fcy - fy * h;
  // the sides the frame cut that still end INSIDE the card: they get the vignette
  const soft = (m.edges.includes('l') && x > -4 ? 'l' : '') + (m.edges.includes('r') && x + w < iw + 4 ? 'r' : '') +
    (m.edges.includes('t') && y > -4 ? 't' : '');
  return { x, y, w, h, fcx, fcy, fh: fh * h, guards, soft };
}

// one axis of the face-aware grid: n cells over [0, L] (edges rounded to whole px), with the keep-out [k0, k1]
// inside ONE cell. An even grid with no edge inside the keep-out is returned as it is. Otherwise the face cell is
// [k0, k1], widened to the card edge where the leftover would be under minT; the other n − 1 cells are shared
// between the two sides by length and spread evenly (a side too short for its share gives cells up).
function cardwall_axis(L, n, k0, k1, minT) {
  const even = []; for (let i = 0; i <= n; i++) even.push(Math.round(i * L / n));
  k0 = clamp(k0, 0, L); k1 = clamp(k1, 0, L);
  if (n < 2 || k1 - k0 < 1 || !even.some(e => e > k0 + 0.5 && e < k1 - 0.5)) return even;
  let a = k0, b = k1;
  if (a < minT) a = 0;
  if (L - b < minT) b = L;
  const rest = n - 1;
  let na = 0, nb = 0;
  if (a > 0 && b < L) {
    if (rest < 2) { if (a < L - b) a = 0; else b = L; }
    else { na = clamp(Math.round(rest * a / (a + L - b)), 1, rest - 1); nb = rest - na; }
  }
  if (a > 0 && b >= L) na = rest; else if (a <= 0 && b < L) nb = rest;
  if (na) na = Math.max(1, Math.min(na, Math.floor(a / minT)));
  if (nb) nb = Math.max(1, Math.min(nb, Math.floor((L - b) / minT)));
  const out = [0];
  for (let i = 1; i <= na; i++) out.push(Math.round(a * i / na));
  for (let i = 0; i < nb; i++) out.push(Math.round(b + (L - b) * i / nb));
  if (out[out.length - 1] !== L) out.push(L);
  return out;
}

// the photo drawn at its natural size with the vignette on the sides in P.soft (56 px in card px), for the backs
// and the floor; the card's own <img> gets the same fade as a CSS mask (cardwall_maskCss)
function cardwall_vignette(img, P) {
  const nw = img.naturalWidth, nh = img.naturalHeight, c = document.createElement('canvas');
  c.width = nw; c.height = nh;
  const x = c.getContext('2d'); x.drawImage(img, 0, 0);
  const kx = nw / P.w, ky = nh / P.h, F = 56;
  x.globalCompositeOperation = 'destination-in';
  for (const s of P.soft) {
    const g = s === 'l' ? x.createLinearGradient(0, 0, F * kx, 0) : s === 'r' ? x.createLinearGradient(nw, 0, nw - F * kx, 0)
      : x.createLinearGradient(0, 0, 0, F * ky);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,1)');
    x.fillStyle = g; x.fillRect(0, 0, nw, nh);
  }
  x.globalCompositeOperation = 'source-over';
  return c;
}
function cardwall_maskCss(soft) {
  const dir = { l: 'to right', r: 'to left', t: 'to bottom' };
  const gs = [...soft].map(s => `linear-gradient(${dir[s]},transparent 0,#000 56px)`);
  if (!gs.length) return '';
  const m = gs.join(','), comp = gs.length > 1 ? `;mask-composite:intersect;-webkit-mask-composite:source-in` : '';
  return `mask-image:${m};-webkit-mask-image:${m}` + comp;
}

// the leftmost opaque column (inner coords) of the placed cut-out over inner rows y0..y1, or null
function cardwall_alphaLeft(img, P, y0, y1) {
  if (!img || !img.naturalWidth || y1 < P.y || y0 > P.y + P.h) return null;
  const k = 0.25, cw = Math.max(1, Math.round(P.w * k)), ch = Math.max(1, Math.round(P.h * k));
  const c = document.createElement('canvas'); c.width = cw; c.height = ch;
  const x = c.getContext('2d'); x.drawImage(img, 0, 0, cw, ch);
  const d = x.getImageData(0, 0, cw, ch).data;
  const r0 = clamp(Math.floor((y0 - P.y) * k), 0, ch - 1), r1 = clamp(Math.ceil((y1 - P.y) * k), 0, ch - 1);
  let best = Infinity;
  for (let r = r0; r <= r1; r++) for (let q = 0; q < Math.min(cw, best); q++) if (d[(r * cw + q) * 4 + 3] > 128) { best = q; break; }
  return best === Infinity ? null : P.x + best / k;
}

// where an x of the photo (inner coords) lands after almLift's peel: dx -8, scale 1.03 about the bottom centre
function cardwall_lifted(P, x) { return x - 8 + 0.03 * (x - (P.x + P.w / 2)); }

// the paragraph, engraved into the paper, wrapped at w (replaces the previous one in place). A last line of ONE
// word (a widow) takes the previous line's last word with it, the way text-wrap:pretty would.
function cardwall_body(p, w) {
  const o = { x: 64, baseline: 567, w, size: 37, weight: 600, lh: 64.5, color: ALM.engraved, shadow: ALM_ENGRAVE };
  let h = fadeLines(p.C.inner, p.bodyText, o);
  const rows = h.lines.map(l => l.textContent.trim().split(/\s+/));
  if (rows.length >= 2 && rows[rows.length - 1].length === 1 && rows[rows.length - 2].length >= 3) {
    rows[rows.length - 1].unshift(rows[rows.length - 2].pop());
    h.el.remove();
    h = fadeLines(p.C.inner, rows.map(r => r.join(' ')).join('\n'), o);
  }
  if (p.body) { p.C.inner.insertBefore(h.el, p.body.el); p.body.el.remove(); }
  else p.C.inner.insertBefore(h.el, p.bodySlot);
  p.body = h; p.bodyW = w;
  return h;
}

// the title type (card.js's: wTitle, B's tracking, word spacing and cream keyline)
const cardwall_TT = { weight: ALM.wTitle, ls: -0.046, ws: 0.08, max: 340, rowMax: 200, B2: 316, top: 46, pitch: 1.0 };
// the width of a run of title type at `size` (as rise() measures it: without the trailing letter-spacing)
function cardwall_measure(text, size) {
  const d = document.createElement('div'), T = cardwall_TT;
  d.style.cssText = `position:absolute;left:0;top:0;visibility:hidden;white-space:pre;font-family:${ALM.font};font-weight:${T.weight};` +
    `letter-spacing:${T.ls}em;word-spacing:${T.ws}em;line-height:1;font-size:${size}px`;
  d.textContent = text; scene.appendChild(d);
  const w = d.getBoundingClientRect().width; scene.removeChild(d);
  return w - T.ls * size;
}
function cardwall_dropTitle(p) {
  if (!p.title) return;
  for (const h of (p.titleRows ? p.title.hs : [p.title])) h.mask.remove();
  p.title = null;
}
// the title, rising out of the mustard band's bottom edge. edge(y0, y1) = the head's left edge (inner x, after the
// lift) over inner rows y0..y1, or null. ONE row first: up to 340 px type (B's cap ~247) and re-fitted so the head
// covers half of its last letter (30 % of a digit, so a year stays readable). Under 200 px type with two or more words it tries TWO rows (the most even word
// split, both at one size, capped by the band's height) and keeps them if they are 15 % bigger.
function cardwall_title(p, edge) {
  const T = cardwall_TT, X = p.titleX, B1 = 401 - p.C.iy, MAXW = 1426, text = String(S.title || '');
  const o = { x: X, weight: T.weight, ls: T.ls, ws: T.ws, color: ALM.ink, shadow: `.017em .004em 0 ${ALM.cream}` };
  const one = maxW => {
    cardwall_dropTitle(p);
    const h = rise(p.C.inner, text, Object.assign({}, o, { baseline: B1, size: T.max, maskY: p.BAND + 1, maxW }));
    p.C.inner.insertBefore(h.mask, p.titleSlot);
    p.title = h; p.titleRows = null;
    return h;
  };
  let h = one(MAXW);
  for (let it = 0; it < 3; it++) {                                            // size and cap must agree
    const E = edge(B1 - h.cap, B1);
    if (E == null) break;
    const lc = h.ch.length ? h.ch[h.ch.length - 1] : null;
    const last = lc ? lc.el.getBoundingClientRect().width : 0.6 * h.size;
    // how much of the LAST letter the head may cover: B's 0.5, a digit 0.3 (it must stay readable). S.title_tuck
    // overrides it: a date or a number wants ~0.05, so the photo only touches the last digit
    const tuck = S.title_tuck != null && isFinite(+S.title_tuck) ? clamp(+S.title_tuck, -0.2, 0.6)
      : lc && /[0-9]/.test(lc.el.textContent) ? 0.3 : 0.5;
    const tw = clamp((E - X) / (1 - tuck * last / Math.max(1, h.width)), 200, MAXW);
    if (Math.abs(tw - h.width) < 2) break;
    h = one(tw);
  }
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (h.size < T.rowMax && words.length >= 2) {
    let best = null;
    for (let k = 1; k < words.length; k++) {
      const rows = [words.slice(0, k).join(' '), words.slice(k).join(' ')];
      const w = Math.max(...rows.map(r => cardwall_measure(r, 100)));
      if (!best || w < best.w) best = { rows, w };
    }
    const capK = h.cap / h.size, sH = (T.B2 - T.top) / (T.pitch + capK);
    const E = edge(T.B2 - (T.pitch + capK) * sH, T.B2);
    const room = E == null ? MAXW : Math.min(MAXW, (E - X) * 1.05);
    const s2 = Math.floor(Math.min(sH, 100 * room / best.w, T.max));
    if (s2 > 1.15 * h.size) {
      cardwall_dropTitle(p);
      const pitch = Math.round(T.pitch * s2);
      const hl = riseLines(p.C.inner, best.rows, Object.assign({}, o, { baseline: T.B2 - pitch, pitch, size: s2, rate: 18.9, desc: 0.22 }));
      for (const x of hl.hs) p.C.inner.insertBefore(x.mask, p.titleSlot);
      p.title = hl; p.titleRows = best.rows;
    }
  }
  const size = p.titleRows ? p.title.hs[0].size : p.title.size;
  p.titleSize = size;
  return size;
}

SCENES.cardwall = {
  build() {
    const T = cardwall_T;
    groundCharcoal();
    const cam = almCam();
    // the camera is its own compositor layer from the start: the 1 % breathe then scales the rasterised card
    // smoothly. Without it Chromium re-snaps the settled title to whole pixels as the scale grows, and the title
    // jumped 1 px in a single frame (4.73 s in the sample) while the photo and bands drifted smoothly.
    cam.style.willChange = 'transform';
    const split = S.split_at == null ? 0.25 : +S.split_at, dl = split - 0.25;
    if (D < 5.1 + dl - 1e-6) console.warn(`cardwall: duration ${D} s is under the minimum ${(5.1 + dl).toFixed(2)} s`);
    const g0 = Array.isArray(S.grid) ? S.grid : [5, 3];
    const cols0 = clamp(Math.round(+g0[0] || 5), 2, 8), rows0 = clamp(Math.round(+g0[1] || 3), 2, 6);
    const ft0 = Array.isArray(S.face_tile) ? S.face_tile : [3, 0];
    const ft = [clamp(Math.round(+ft0[0]), 0, cols0 - 1), clamp(Math.round(+ft0[1]), 0, rows0 - 1)];

    // ── the real card (card.js's layout), hidden until the swap ──────────────────────────────────────────
    const C = makeCard({ parent: cam });
    C.el.style.background = 'transparent'; C.el.style.boxShadow = 'none'; C.el.style.opacity = 0;
    const iw = C.iw, ih = C.ih, RX = C.ix, RY = C.iy;                         // 1630 x 886 at (145, 97)
    const BAND = 485.5 - C.iy, STRIPE = 96, PAPER = BAND + STRIPE;              // 388.5 / 484.5, as card.js
    almFill(C.inner, 0, BAND, iw, STRIPE, ALM.stripe);
    almFill(C.inner, 0, PAPER, iw, ih - PAPER, ALM.paperStock);
    almFill(C.inner, 0, 0, iw, BAND, S.band || ALM.mustard);
    let label = null;
    if (S.stripe_label) {
      label = document.createElement('div'); label.className = 'alm-fill';
      label.style.cssText = `left:${248 - C.ix}px;top:${almPx(BAND + STRIPE / 2 - 11)};height:22px;line-height:22px;white-space:nowrap;` +
        `font-weight:800;font-size:22px;letter-spacing:.2em;text-transform:uppercase;color:${ALM.mustard}`;
      label.textContent = S.stripe_label; C.inner.appendChild(label);
    }
    const titleSlot = document.createElement('div'); titleSlot.style.display = 'none'; C.inner.appendChild(titleSlot);
    const bodySlot = document.createElement('div'); bodySlot.style.display = 'none'; C.inner.appendChild(bodySlot);
    cardFinish(C, { grain: 2.2, grainRect: [0, PAPER, iw, ih - PAPER] });      // B's paper grain on the paper only

    // ── the photo: by the face, on the EVEN grid; then the grid bends around the face ────────────────────────
    const ex = [], ey = [];
    for (let c = 0; c <= cols0; c++) ex.push(Math.round(c * iw / cols0));
    for (let r = 0; r <= rows0; r++) ey.push(Math.round(r * ih / rows0));
    const P = cardwall_place(S.cutout, iw, ih, ex, ey, ft);
    const xs = cardwall_axis(iw, cols0, P.fcx - 0.42 * P.fh, P.fcx + 0.42 * P.fh, Math.min(220, 0.75 * iw / cols0));
    const ys = cardwall_axis(ih, rows0, P.fcy - 0.40 * P.fh, P.fcy + 0.32 * P.fh, Math.min(220, 0.75 * ih / rows0));
    const cols = xs.length - 1, rows = ys.length - 1;
    // above the texture, below the shade (B's object is clean); a frame-cut side that cannot bleed fades out
    const cut = cutout(C.inner, S.cutout, { x: P.x, y: P.y, w: P.w, h: P.h, shadow: false, origin: '50% 100%' });
    if (P.soft) cut.img.style.cssText += ';' + cardwall_maskCss(P.soft);
    C.inner.insertBefore(cut.el, C.shade);

    // ── the ring: makeCard's border (hole with its 64 px inner radius, 1 px over the inner edge), shadow, rim ───
    const ring = document.createElement('div'); ring.className = 'alm-fill';
    ring.style.cssText = `left:${C.x}px;top:${C.y}px;width:${C.w}px;height:${C.h}px;transform-origin:50% 50%;opacity:0`;
    ring.innerHTML = `<svg width="${C.w}" height="${C.h}" style="position:absolute;left:0;top:0;overflow:visible">` +
      `<path fill="#000" fill-rule="evenodd" d="${cardwall_rrect(0, 0, C.w, C.h, C.r)}${cardwall_rrect(C.b + 1, C.b + 1, C.w - 2 * C.b - 2, C.h - 2 * C.b - 2, Math.max(0, C.ri - 1))}"/></svg>` +
      `<div style="position:absolute;inset:0;border-radius:${C.r}px;box-shadow:inset 0 -1.2px 0 rgba(255,255,255,.085),inset 0 0 0 1px rgba(255,255,255,.025),0 10px 44px 2px rgba(0,0,0,.45)"></div>`;
    cam.appendChild(ring);

    // ── the back picture: the inner composition (bands + texture, no text), composed ONCE from cardFinish's canvases
    const comp = document.createElement('canvas'); comp.width = iw; comp.height = ih;
    {
      const x = comp.getContext('2d');
      x.fillStyle = S.band || ALM.mustard; x.fillRect(0, 0, iw, BAND);
      x.fillStyle = ALM.stripe; x.fillRect(0, BAND, iw, STRIPE);
      x.fillStyle = ALM.paperStock; x.fillRect(0, PAPER, iw, ih - PAPER);
      if (C.tex) {
        x.globalCompositeOperation = 'multiply'; x.drawImage(C.tex.dark, 0, 0);
        x.globalCompositeOperation = 'source-over'; x.globalAlpha = 0.25; x.drawImage(C.tex.light, 0, 0); x.globalAlpha = 1;
        x.globalCompositeOperation = 'overlay'; x.drawImage(C.tex.sheen, 0, 0);
        x.globalCompositeOperation = 'source-over';
      }
    }

    // ── the film: ONE master canvas at the wall's opening scale; it is also the cover before the crack ───────
    const s0 = Math.max(W / iw, H / ih);
    const MW = Math.round(iw * s0), MH = Math.round(ih * s0);
    const F = S.footage ? almFootage(S.footage)
      : almFootage({ frames: S.image ? [S.image] : [], fps: 15, focus_y: S.focus_y == null ? 0.5 : +S.focus_y, grade: S.grade || 'mono' });
    const master = document.createElement('canvas'); master.width = MW; master.height = MH;
    master.style.cssText = `position:absolute;left:${RX}px;top:${RY}px;width:${iw}px;height:${ih}px;` +
      `transform-origin:${W / 2 - RX}px ${H / 2 - RY}px;transform:scale(${s0.toFixed(6)});background:${ALM.cardInk}`;
    const mctx = master.getContext('2d');

    // ── the wall: a flat shadow layer under a 3D layer of tiles (front = film slice, back = card slice) ───────
    const st = document.createElement('style');
    st.textContent = `.cw-layer{position:absolute;left:0;top:0;width:${W}px;height:${H}px;transform-origin:${W / 2}px ${H / 2}px}
      .cw-tile{position:absolute;transform-style:preserve-3d}
      .cw-face{position:absolute;left:0;top:0;overflow:hidden;backface-visibility:hidden;-webkit-backface-visibility:hidden}
      .cw-face canvas{position:absolute;left:0;top:0}
      .cw-bd{position:absolute;inset:0}
      .cw-sh{position:absolute;background:#000;transform-origin:50% 50%}`;
    document.head.appendChild(st);
    const shLayer = document.createElement('div'); shLayer.className = 'cw-layer';
    const wall = document.createElement('div'); wall.className = 'cw-layer';
    wall.style.perspective = '2800px'; wall.style.perspectiveOrigin = `${W / 2}px ${H / 2}px`;
    const wallIn = document.createElement('div'); wallIn.className = 'cw-layer'; wallIn.style.transformStyle = 'preserve-3d';
    wall.appendChild(wallIn);
    // the floor: the fused picture as ONE flat canvas under the wall, rounded like the card's inner. Coplanar 3D
    // tiles rasterise their edges one by one, so two anti-aliased edges meet on the same pixel column and the
    // charcoal shows through as a 1 px seam even at g = 0; over this floor the seam shows the same picture instead.
    const floor = document.createElement('canvas'); floor.width = iw; floor.height = ih;
    floor.style.cssText = `position:absolute;left:${RX}px;top:${RY}px;width:${iw}px;height:${ih}px;border-radius:${C.ri}px;visibility:hidden`;
    floor.getContext('2d').drawImage(comp, 0, 0);
    cam.insertBefore(shLayer, C.el); cam.insertBefore(floor, C.el); cam.insertBefore(wall, C.el); cam.insertBefore(master, C.el);

    const rng = almRng(((S.seed || 7) * 7919 + 4099) >>> 0), kmax = cols + rows - 2;
    const stag = Math.min(0.085, 0.535 / Math.max(1, kmax));
    const tiles = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      // +2: neighbours overlap by 2 px (not past the card's own edge)
      const x0 = xs[c], y0 = ys[r], tw = xs[c + 1] - x0 + (c < cols - 1 ? 2 : 0), th = ys[r + 1] - y0 + (r < rows - 1 ? 2 : 0);
      const el = document.createElement('div'); el.className = 'cw-tile';
      el.style.cssText = `left:${RX + x0}px;top:${RY + y0}px;width:${tw}px;height:${th}px;transform-origin:${tw / 2}px ${th / 2}px`;
      const mk = back => {
        const f = document.createElement('div'); f.className = 'cw-face';
        f.style.width = tw + 'px'; f.style.height = th + 'px';
        if (back) f.style.transform = 'rotateY(180deg)';
        const cv = document.createElement('canvas');
        const k = back ? 1 : s0;                                     // fronts at the opening scale: 1:1 with the master
        cv.width = Math.ceil(tw * k); cv.height = Math.ceil(th * k);
        cv.style.width = tw + 'px'; cv.style.height = th + 'px';
        if (!back) cv.style.background = ALM.cardInk;
        const bd = document.createElement('div'); bd.className = 'cw-bd';
        f.appendChild(cv); f.appendChild(bd); el.appendChild(f);
        return { f, cv, bd, ctx: cv.getContext('2d') };
      };
      const front = mk(false), back = mk(true);
      back.ctx.drawImage(comp, x0, y0, tw, th, 0, 0, tw, th);
      wallIn.appendChild(el);
      const sh = document.createElement('div'); sh.className = 'cw-sh';
      sh.style.cssText = `left:${RX + x0}px;top:${RY + y0}px;width:${xs[c + 1] - x0}px;height:${ys[r + 1] - y0}px`;
      shLayer.appendChild(sh);
      // which of its corners are the CARD's corners (they round to the ring's hole in the fuse)
      const L = c === 0, R = c === cols - 1, Tp = r === 0, B = r === rows - 1;
      tiles.push({ c, r, x0, y0, tw, th, el, front, back, sh, oc: [Tp && L, Tp && R, B && R, B && L],
        start: 0.85 + dl + stag * (c + r) + (rng() - 0.5) * 0.05, rz: (rng() - 0.5) * 2 * T.tilt });
    }
    const waveEnd = Math.max(...tiles.map(q => q.start)) + T.flip;

    // the body: at most 180 characters, cut at the last word that fits (never mid-word)
    let bodyText = String(S.body || '').trim();
    if (bodyText.length > 180) {
      let k = bodyText.lastIndexOf(' ', 180); if (k < 120) k = 180;
      bodyText = bodyText.slice(0, k).replace(/[\s,;:.–—-]+$/, '') + '…';
      console.warn(`cardwall: body is ${String(S.body).length} characters, cut to ${bodyText.length} (keep it <= 180)`);
    }

    const p = parts = { cam, C, BAND, cut, P, ring, floor, label, body: null, bodyText, bodySlot, titleSlot, title: null,
      titleRows: null, titleX: 248 - C.ix, F, master, mctx, MW, MH, s0, wall, wallIn, shLayer, tiles, dl, split, cols, rows,
      xs, ys, waveEnd };

    cardwall_body(p, 720);
    // the title: first from the face box (an estimate), then — once decoded — from the photo's real silhouette
    const est = cardwall_lifted(P, P.fcx - 0.55 * P.fh) + 30;
    if (S.title) cardwall_title(p, () => est);
    const img = cut.img;
    // a picture the browser cannot decode (a director's stray value, a truncated file) plays as the card without its
    // photo: a rejected decode handed to almHoldReady would fail the whole kit batch
    const lost = () => { cut.el.style.display = 'none'; console.warn('cardwall: the cut-out cannot be decoded; the card plays without it'); };
    if (almSrc(S.cutout)) almHoldReady(img.decode().then(() => {
      // the photo (vignetted where the frame cut it) onto the backs and the floor, once, where it sits on the card
      const pv = P.soft ? cardwall_vignette(img, P) : img;
      for (const q of tiles) {
        const x = q.back.ctx; x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
        x.drawImage(pv, P.x - q.x0, P.y - q.y0, P.w, P.h);
      }
      { const x = floor.getContext('2d'); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high'; x.drawImage(pv, P.x, P.y, P.w, P.h); }
      // the paragraph keeps 36 px clear of the photo once it has peeled (on the rows five lines could take)
      const Eb = cardwall_alphaLeft(img, P, 567 - 30, 567 + 4 * 64.5 + 10);
      if (Eb != null && p.bodyText) {
        const bw = clamp(Math.floor(cardwall_lifted(P, Eb) - 36 - 64), 360, 720);
        if (bw < p.bodyW) cardwall_body(p, bw);
      }
      if (S.title) {
        const size = cardwall_title(p, (y0, y1) => { const e = cardwall_alphaLeft(img, P, y0, y1); return e == null ? null : cardwall_lifted(P, e); });
        if (size < 200) console.warn(`cardwall: title "${S.title}" sets at ${Math.round(size)} px (${p.titleRows ? 'two rows' : 'one row'}); ` +
          'a ref-B card wants <= 10 characters next to a face');
      }
      const he = cardwall_alphaLeft(img, P, 401 - C.iy - 200, 401 - C.iy);
      p.headEdge = he == null ? null : cardwall_lifted(P, he);
    }, lost));
  },

  frame(tRaw) {
    const p = parts, dl = p.dl, T = cardwall_T;
    const t = almSharp(tRaw);                                                  // whole frames, like the references
    const u = t - p.split;
    const kS = smooth(u / 0.70), kE = eo3(clamp(u / 0.70));                   // the crack: smooth / eo3 parts
    const kF = smooth((t - (T.fuse0 + dl)) / T.fuseDur);                      // the fuse: shut when the swap starts
    const kFs = smooth((t - (T.fuse0 + dl)) / (T.fuseDur + 0.07));            // (the shadows a little slower)
    const swap = T.swap0 + dl, pre = u < 0, wallOn = !pre && t < swap + T.swapDur;
    const s = lerp(p.s0, 1, kS), g = T.gutter * kS * (1 - kF);
    const bw = 5 * kE * (1 - kF), rad = 12 * kE * (1 - kF), radO = lerp(12 * kE, p.C.ri, kF);
    const mg = T.margin * kS * (1 - kF), shO = 0.45 * kE * (1 - kFs);

    // ── the film: the master canvas holds the graded frame (plus card stock once the crack starts) ──────────
    const needFilm = pre || (wallOn && t < p.waveEnd);
    if (needFilm && p.F.n) {
      const x = p.mctx;
      x.clearRect(0, 0, p.MW, p.MH);
      p.F.draw(x, p.F.idx(t, 0), 0, 0, p.MW, p.MH);
      if (kE > 0 && p.C.tex) {
        x.save(); x.globalAlpha = 0.3 * kE;
        x.globalCompositeOperation = 'multiply'; x.drawImage(p.C.tex.dark, 0, 0, p.MW, p.MH);
        x.globalCompositeOperation = 'source-over'; x.drawImage(p.C.tex.light, 0, 0, p.MW, p.MH);
        x.restore();
      }
    }
    p.master.style.visibility = pre ? 'visible' : 'hidden';
    p.wall.style.visibility = wallOn ? 'visible' : 'hidden';
    p.shLayer.style.visibility = wallOn ? 'visible' : 'hidden';
    // the floor from when the gutters are under 0.4 px
    p.floor.style.visibility = wallOn && t >= T.fuse0 + 0.93 * T.fuseDur + dl ? 'visible' : 'hidden';

    if (wallOn) {
      const sc = `scale(${s.toFixed(5)})`;
      p.wallIn.style.transform = sc; p.shLayer.style.transform = sc;
      const cx = (p.cols - 1) / 2, cy = (p.rows - 1) / 2;
      const px = v => v.toFixed(2) + 'px';
      for (const Q of p.tiles) {
        // the flip on the RAW time (motion blur at shutter > 1); the landing slap after q = land
        const q = clamp((tRaw - Q.start) / T.flip);
        const f = cardwall_turn(q / T.land), a = 180 * f, lift = Math.sin(Math.PI * f);
        let z = 90 * lift, scl = 1 + 0.06 * lift, slap = 0;
        if (q > T.land && q < 1) {
          const v = (q - T.land) / (1 - T.land); slap = Math.sin(Math.PI * v) * (1 - v);
          z = -5 * slap; scl = 1 - 0.012 * Math.sin(Math.PI * v);
        }
        const dx = (Q.c - cx) * g, dy = (Q.r - cy) * g, rz = Q.rz * kE * (1 - kF);
        Q.el.style.transform = `translate3d(${dx.toFixed(2)}px,${dy.toFixed(2)}px,${z.toFixed(2)}px) rotateZ(${rz.toFixed(3)}deg) rotateY(${a.toFixed(3)}deg) scale(${scl.toFixed(5)})`;
        // corners: the card's own four round to the ring's hole in the fuse, the rest close to square
        const br = Q.oc.map(o => px(o ? radO : rad)).join(' ');
        // the tile's edge is an inset box-shadow, not a border: Chromium draws any border under 1 px as a full
        // pixel, so a fading border leaves hard 1 px lines on the fused wall. The fronts are printed with a cream
        // margin inside the black edge (a cigarette card); the backs are the ALMANAC card, black edge only.
        const bsB = bw < 0.01 ? 'none' : `inset 0 0 0 ${bw.toFixed(2)}px #0B0B0B`;
        const bsF = bw < 0.01 ? 'none' : `${bsB},inset 0 0 0 ${(bw + mg).toFixed(2)}px ${ALM.paper}`;
        Q.front.f.style.borderRadius = br; Q.front.bd.style.borderRadius = br; Q.front.bd.style.boxShadow = bsF;
        Q.back.f.style.borderRadius = br; Q.back.bd.style.borderRadius = br; Q.back.bd.style.boxShadow = bsB;
        // the front shows the tile's slice of the current film frame while it faces the camera
        if (a < 91 && p.F.n) {
          const k = p.s0, cv = Q.front.cv;
          Q.front.ctx.drawImage(p.master, Q.x0 * k, Q.y0 * k, cv.width, cv.height, 0, 0, cv.width, cv.height);
        }
        // the shadow: narrows with the turn, widens and softens with the lift, snaps tight on the slap
        const sx = Math.max(0.1, Math.abs(Math.cos(a * Math.PI / 180))) * scl;
        Q.sh.style.opacity = (shO * (1 + 0.3 * slap)).toFixed(4);
        Q.sh.style.borderRadius = br;
        Q.sh.style.filter = `blur(${(12 + 24 * lift - 6 * slap).toFixed(2)}px)`;
        Q.sh.style.transform = `translate(${dx.toFixed(2)}px,${(dy + 10 + 34 * lift - 5 * slap).toFixed(2)}px) rotate(${rz.toFixed(3)}deg) scale(${sx.toFixed(4)},${scl.toFixed(4)})`;
      }
    }

    // ── the ring CLAMPS on (in fast, then scale 1.035 → 1 with a small overshoot); the card cross-fades in ────
    const r0 = T.ring0 + dl;
    p.ring.style.opacity = eo3(clamp((t - r0) / 0.10)).toFixed(4);
    const rp = clamp((t - r0) / 0.30), rs = lerp(1.035, 1, eback(rp));
    p.ring.style.transform = Math.abs(rs - 1) < 1e-5 ? 'none' : `scale(${rs.toFixed(5)})`;
    p.C.el.style.opacity = smooth((t - swap) / T.swapDur).toFixed(4);

    // ── title, photo lift, label, body, breathe ─────────────────────────────────────────────────────────────
    if (p.title) {
      if (p.titleRows) riseLinesFrame(p.title, t, T.title0 + dl);
      else riseFrame(p.title, t, T.title0 + dl, 18.9);
    }
    almLift(p.cut.el, eo3(clamp((t - (T.lift0 + dl)) / 0.50)), { shadow: { x: 18, y: 28, blur: 36, a: 0.42 }, scale: 1.03, dx: -8, origin: '50% 100%' });
    if (p.label) p.label.style.opacity = eo3(clamp((t - (T.label0 + dl)) / 0.40)).toFixed(4);
    fadeLinesFrame(p.body, t, T.body0 + dl, 0.08, 0.42);
    breathe(p.cam, t, T.breathe0 + dl, D, 0.01);
  },
};

/* register.js — SCENES.register: THE PRESS PROOF (ALMANAC template 5).
   The page is printed while you watch, one ink at a time. The mustard plate (M), a paper-white keyline plate (W) and
   the black plate (K) each land OUT OF REGISTER, carrying their own crop marks, crosshairs and colour patches, and
   snap into place. The portrait is printed as two halftone screens (K 45°, M 15°) whose dots refine from 44 px to
   7 px while a moiré rosette crawls across the face; it resolves into a continuous-tone duotone print. The camera
   trims the proof sheet down to the finished full-bleed page, the print peels up off the page, and an optional red
   proof stamp slams the verdict.

   S: { type:'register', title (1 row ≤ ~7 characters at full size; ≤ ~14 on two rows), kicker, subtitle, body
        (≤ 3 lines; better left empty with a stamp), media {kind:'cutout', src} (almanac_prep adds ar / face / edges),
        face_cx (1480), duotone (0.30: the mustard tint of the resolved photo), misregister (1.0; .5 polite, 1.6 wild),
        trim (true; only from D 5.0), slug (title), folio (''), series ('': the channel's name for slug and folio),
        band ('mustard' | 'yellow'), stamp (≤ 10 chars),
        stamp_sub, stamp_at, stamp_rot (-7) }

   Layer stack, bottom → top (all but the shutter inside #sheet, the camera; page layers in final-frame coordinates,
   shown at 0.866667x at (128, 56) in the proof state):
     ground (charcoal) · sheet paper (paperStock) + fibre · sheet furniture (pre-printed target / colour-bar
     outlines, fold tick, slug) · plate M (multiply) · plate W (normal) · plate K (multiply) · print texture (.55) ·
     photo (almLift) · stamp · core shutter.
   Knock-outs: plates M and K each carry a WHITE silhouette of the photo above their ink (white × multiply = no ink);
   plate W has the silhouette masked out. The halftone screens are clipped to the same (1 px choked) silhouette, so
   the band, stripe and letters never show between the dots or through the half-resolved photo, and the photo's edge
   is one clean line. Once the photo is opaque the screens have faded out and the knock-outs go.

   The layout runs once the cut-out has decoded (build holds the renderer on it): the photo is placed by its face and
   its REAL alpha profile — the crown stays ≥ 48 px under the frame top after the lift and the push, the title stops
   28 px short of whatever the silhouette puts at the title's rows (hat brims, ears), the subtitle and stamp stop
   40 px short of it.

   Clock: letters, fades, band wipes, screens and the stamp run on almSharp(t) (whole frames, like the references);
   the plate fly-ins, the camera, the lift and the jolt run on raw t, so a shutter > 1 blurs them. Build times are
   the spec's τ·κ with κ = clamp((D − 1.6)/5.4, .45, 1); the letter stagger stays 1/25 s.

   Helpers used from core: groundCharcoal, almFill, bandWipe, rise, riseLinesFrame, almWrap, fadeLines /
   fadeLinesFrame, paperTexture, almUnder, almHex, almCut, almLift, almHoldReady, almStamp, almJolt, almBaseline,
   almInk, shutterBuild / shutter, smooth, ease3, almSharp.
   Local helpers (register_*): the generalised back ease (a snap with a fixed overshoot), the plate offset curve, the
   proof marks / outlines / patches, the one-line fit, the caps, the alpha profile, the lift map, the photo
   placement, the title rows, the halftone lattice, the prep (luma grid, silhouette, duotone, ghost screen). */

// ── small maths ──────────────────────────────────────────────────────────────────────────────────
// back ease with a free constant c (the kit's eback is c = 1.6, a 9 % overshoot)
function register_back(x, c) { x = clamp(x); return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); }
// the c whose overshoot is `phi` of the move: max(back) − 1 = 4c³ / (27 (c+1)²)
function register_backC(phi) {
  let lo = 0.01, hi = 30;
  for (let i = 0; i < 48; i++) { const c = (lo + hi) / 2; if (4 * c * c * c / (27 * (c + 1) * (c + 1)) < phi) lo = c; else hi = c; }
  return (lo + hi) / 2;
}
// a plate's offset [dx, dy, rot] at t: o0 → near miss o1 (eo3, t0..t1), o1 → register with the back snap (t1..t2)
function register_off(t, t0, t1, t2, o0, o1, c) {
  if (t <= t0) return o0.slice();
  if (t < t1) { const e = eo3(seg(t, t0, t1)); return o0.map((v, i) => lerp(v, o1[i], e)); }
  const e = register_back(seg(t, t1, t2), c);
  return o1.map(v => v * (1 - e));
}

// ── proof furniture (sheet coordinates) ──────────────────────────────────────────────────────────
const register_TARGETS = [[64, 524], [1856, 524], [960, 28]];
const register_PATCH = { x: 1236, y: 1024, w: 72, h: 28, pitch: 78 };
// one plate's crop marks + registration targets (circle r 17, a 56 px crosshair, a filled quarter disc so a rotated
// plate reads as rotated)
function register_marks(ink) {
  const L = (a, b, c, d) => `<line x1="${a}" y1="${b}" x2="${c}" y2="${d}"/>`;
  let s = `<svg class="abs" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="left:0;top:0;overflow:visible" stroke="${ink}" stroke-width="2" fill="none">`;
  s += L(74, 56, 114, 56) + L(128, 2, 128, 42) + L(1806, 56, 1846, 56) + L(1792, 2, 1792, 42);
  s += L(74, 992, 114, 992) + L(128, 1006, 128, 1046) + L(1806, 992, 1846, 992) + L(1792, 1006, 1792, 1046);
  for (const [cx, cy] of register_TARGETS) {
    s += `<circle cx="${cx}" cy="${cy}" r="17"/>` + L(cx - 28, cy, cx + 28, cy) + L(cx, cy - 28, cx, cy + 28);
    s += `<path d="M${cx} ${cy}L${cx} ${cy - 11}A11 11 0 0 1 ${cx + 11} ${cy}Z" fill="${ink}" stroke="none"/>`;
  }
  return s + '</svg>';
}
// the pre-printed outlines on the sheet itself: 1 px #CFCAC2 targets (where the plates must land) and colour-bar
// patch outlines, plus a fold tick at the sheet's centre
function register_outlines() {
  const c = '#CFCAC2', P = register_PATCH;
  let s = `<svg class="abs" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="left:0;top:0;overflow:visible" stroke="${c}" stroke-width="1" fill="none">`;
  for (const [cx, cy] of register_TARGETS) s += `<circle cx="${cx}" cy="${cy}" r="17"/><line x1="${cx - 28}" y1="${cy}" x2="${cx + 28}" y2="${cy}"/><line x1="${cx}" y1="${cy - 28}" x2="${cx}" y2="${cy + 28}"/>`;
  for (let i = 0; i < 7; i++) s += `<rect x="${P.x + i * P.pitch + 0.5}" y="${P.y + 0.5}" width="${P.w - 1}" height="${P.h - 1}"/>`;
  s += `<line x1="960" y1="1000" x2="960" y2="1016" stroke-dasharray="3 3"/>`;
  return s + '</svg>';
}
// a plate's colour-bar fills: [patch index, tint]
function register_patches(ink, list) {
  const P = register_PATCH;
  return list.map(([i, a]) => `<div class="abs" style="left:${P.x + i * P.pitch}px;top:${P.y}px;width:${P.w}px;height:${P.h}px;background:${ink};opacity:${a}"></div>`).join('');
}

// ── layout helpers ───────────────────────────────────────────────────────────────────────────────
// a full-frame wrapper in final-frame (page) coordinates; placed into the proof sheet at the end of the layout
function register_page(parent) {
  const d = document.createElement('div'); d.className = 'register-pg'; parent.appendChild(d); return d;
}
function register_canvas(parent, x, y, w, h) {
  const c = document.createElement('canvas'); c.width = Math.ceil(w); c.height = Math.ceil(h); c.className = 'register-cv';
  c.style.cssText = `left:${almPx(x)};top:${almPx(y)};width:${almPx(Math.ceil(w))};height:${almPx(Math.ceil(h))}`;
  parent.appendChild(c); return c;
}
// the largest size ≤ size at which a one-line string fits maxW (DOM probe: tracking and kerning included)
function register_fit(text, size, weight, ls, maxW) {
  const d = document.createElement('div');
  d.style.cssText = `position:absolute;left:0;top:0;visibility:hidden;white-space:pre;font-family:${ALM.font};font-weight:${weight};letter-spacing:${ls}em;line-height:1`;
  d.style.fontSize = size + 'px'; d.textContent = text; scene.appendChild(d);
  let s = size, w = d.getBoundingClientRect().width - ls * s;
  for (let k = 0; k < 4 && w > maxW; k++) { s = Math.floor(s * maxW / w * 100) / 100; d.style.fontSize = s + 'px'; w = d.getBoundingClientRect().width - ls * s; }
  scene.removeChild(d); return s;
}
// the ink-run width of a one-line string (the trailing letter-spacing removed)
function register_width(text, size, weight, ls) {
  const d = document.createElement('div');
  d.style.cssText = `position:absolute;left:0;top:0;visibility:hidden;white-space:pre;font-family:${ALM.font};font-weight:${weight};letter-spacing:${ls}em;line-height:1;font-size:${size}px`;
  d.textContent = text; scene.appendChild(d);
  const w = d.getBoundingClientRect().width - ls * size;
  scene.removeChild(d); return w;
}
// upper case the way a legal kicker is set: a standalone "v." (versus) stays lower case
function register_caps(s) {
  return String(s || '').split(/(\s+)/).map(w => /^v\.?$/i.test(w) ? 'v.' : w.toUpperCase()).join('');
}
// a paragraph's sentences (a full stop after an initial or a common abbreviation — "James H. Wilkerson",
// "U.S. v. Capone", "No. 85" — does not end one)
function register_sentences(text) {
  const out = [], re = /[.!?]["'\u201D\u2019)]*(?=\s+|$)/g, t = String(text || '').trim();
  let a = 0, mm;
  while ((mm = re.exec(t))) {
    const end = mm.index + mm[0].length, head = t.slice(a, mm.index + 1), next = t.slice(end).trimStart();
    if (/(^|[\s(])([A-Za-z]|Mr|Mrs|Ms|Dr|St|Jr|Sr|No|Nos|vs?|Gen|Col|Lt|Capt|Sgt|Gov|Sen|Rep|U\.S|Inc|Co|Jan|Feb|Mar|Apr|Aug|Sept?|Oct|Nov|Dec)\.$/.test(head)) continue;
    if (next && !/^[A-Z0-9"'\u201C\u2018(]/.test(next)) continue;
    out.push(t.slice(a, end).trim()); a = end;
  }
  if (a < t.length && t.slice(a).trim()) out.push(t.slice(a).trim());
  return out;
}
// the cut-out's alpha profile: per row (N rows over the image height) the leftmost opaque x as a fraction of the
// width (2 = an empty row), and the alpha top (the crown) as a fraction of the height
function register_profile(img) {
  const N = 540, M = Math.max(8, Math.round(N * img.naturalWidth / Math.max(1, img.naturalHeight)));
  const c = document.createElement('canvas'); c.width = M; c.height = N;
  const x = c.getContext('2d'); x.drawImage(img, 0, 0, M, N);
  const d = x.getImageData(0, 0, M, N).data, left = new Float32Array(N);
  let top = -1;
  for (let r = 0; r < N; r++) {
    let l = -1;
    for (let q = 0; q < M; q++) if (d[(r * M + q) * 4 + 3] > 127) { l = q; break; }
    left[r] = l < 0 ? 2 : l / M;
    if (l >= 0 && top < 0) top = r / N;
  }
  return { N, left, top: Math.max(0, top) };
}
// the peel: where a page point of the photo ends up after almLift (origin: the box's bottom centre)
const register_LIFT = { scale: 1.02, dx: -6, dy: -14, rot: -0.4, shadow: { x: 18, y: 26, blur: 34, a: 0.40 } };
function register_liftPt(x, y, box, on) {
  if (!on) return [x, y];
  const L = register_LIFT, ox = box.x + box.w / 2, oy = box.y + box.h, th = L.rot * Math.PI / 180;
  const u = (x - ox) * L.scale, v = (y - oy) * L.scale;
  return [ox + u * Math.cos(th) - v * Math.sin(th) + L.dx, oy + u * Math.sin(th) + v * Math.cos(th) + L.dy];
}
// the photo, placed by its face (one solve):
//   size   h = max(800/ar, 799/(1−cy)), the face capped at 400 px, and small enough that the face centre can sit
//          ≤ 600 with the crown clear;
//   face   centre y = clamp(1104 − (1−cy)·h, 305, 600) — seated portraits keep the face high in the band, head-and-
//          shoulders mugshots land their face across the stripe, as reference A does;
//   crown  ≥ 48 px under the frame top at the END of the scene (after the lift and the 1.5 % push);
//   bleed  a side the photo was cut by its frame (prep `edges`) never ends inside the page when it can bleed: the
//          right cut moves the photo right (the face keeps its size), a bottom cut grows the photo, a top cut lifts
//          it. The left cut (facing the text) stays a straight print edge: a lifted print keeps its cut.
// Returns {box, leftAt(y0, y1)}: the leftmost silhouette x over page rows y0..y1, before or after the lift.
function register_place(meta, prof, lift, push) {
  const ar = meta.ar, cx = meta.face[0], cy = meta.face[1], fh = Math.max(0.05, meta.face[2]);
  const top = prof ? prof.top : (meta.top || 0), ed = meta.edges || '';
  // build-time crown y that ends at 48: the push maps y → 540 + push·(y − 540); the lift raises the crown by
  // −dy + (scale − 1)·(photo height above its foot)
  const need = h => lift ? 540 - (540 - 48) / push - register_LIFT.dy + (register_LIFT.scale - 1) * (1 - top) * h + 2
                         : 540 - (540 - 48) / push;
  let h = Math.max(800 / ar, (1104 - 305) / (1 - cy));
  h = Math.min(h, 400 / fh);
  if (cy - top > 0.05) for (let k = 0; k < 2; k++) h = Math.min(h, (600 - need(h)) / (cy - top));
  let fy = clamp(1104 - (1 - cy) * h, 305, 600);
  if (!ed.includes('t')) fy = Math.max(fy, need(h) + (cy - top) * h);
  if (ed.includes('b') && fy + (1 - cy) * h < 1104) {                     // a bottom cut must bleed
    h = (1104 - fy) / (1 - cy);
    if (!ed.includes('t')) fy = Math.max(fy, need(h) + (cy - top) * h);
  }
  if (ed.includes('t')) fy = Math.min(fy, cy * h - 24);                   // a top cut must bleed
  const w = h * ar;
  let fcx = S.face_cx == null ? 1480 : +S.face_cx;
  if (ed.includes('r')) fcx = Math.max(fcx, W + 24 - (1 - cx) * w);
  const box = { x: fcx - cx * w, y: fy - cy * h, w, h };
  const leftAt = (y0, y1) => {
    let best = W + 200;
    if (!prof) return y1 < fy + 0.6 * fh * h ? fcx - 0.55 * fh * h : box.x;
    for (let y = y0 - 16; y <= y1 + 16; y += 3) {
      const r = Math.floor((y - box.y) / box.h * prof.N);
      if (r < 0 || r >= prof.N || prof.left[r] > 1) continue;
      const x = box.x + prof.left[r] * box.w;
      best = Math.min(best, x, register_liftPt(x, y, box, lift)[0]);
    }
    return best;
  };
  return { box, fcx, leftAt };
}
// the title in 1 or 2 rows, each a core rise(): the last row rises out of the stripe edge (mask 500), row 1 out of
// its own baseline. K and W build the same rows at the same geometry. Returns a riseLines-shaped handle
// {hs, starts, n, rate} for core riseLinesFrame.
function register_title(parent, rows, g, color) {
  const hs = [], starts = []; let n = 0;
  rows.forEach((row, k) => {
    const last = k === rows.length - 1, b = g.base + k * g.pitch;
    hs.push(rise(parent, row, { x: 150, baseline: b, size: g.size, weight: g.w, ls: -0.03, color, maxW: g.maxW,
      maskY: last ? 500 : b + g.size * (/[a-z]/.test(row) ? 0.26 : 0.06) }));
    starts.push(n / 25); n += row.length + (last ? 0 : 1);
  });
  return { hs, starts, n, rate: 25, size: hs[0] ? hs[0].size : g.size };
}

// ── the halftone ─────────────────────────────────────────────────────────────────────────────────
// one plate's screen of the photo into ctx: a lattice of `cell` px at `ang`°, centred on the box centre (so every
// plate and the ghost share it); `off` = where page (0,0) sits in the canvas. Dots skip where the cut-out's alpha
// < .5; the radius follows the spec's K / M curves on d = 1 − L, bilinear-sampled from the 1/4-scale luma grid.
function register_dots(ctx, G, cell, ang, kind, box, off, ink) {
  if (!G) return;
  const a = ang * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
  const cx0 = off + box.x + box.w / 2, cy0 = off + box.y + box.h / 2;
  const n = Math.ceil(Math.hypot(box.w, box.h) / 2 / cell) + 1, gw = G.w, gh = G.h, L = G.L, A = G.A;
  const kx = gw / box.w, ky = gh / box.h, isK = kind === 'K';
  ctx.fillStyle = ink; ctx.beginPath();
  for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) {
    const x = cx0 + (i * ca - j * sa) * cell, y = cy0 + (i * sa + j * ca) * cell;
    const lx = x - off - box.x, ly = y - off - box.y;
    if (lx < 0 || ly < 0 || lx >= box.w || ly >= box.h) continue;
    const u = clamp(lx * kx - 0.5, 0, gw - 1), v = clamp(ly * ky - 0.5, 0, gh - 1);
    const u0 = Math.floor(u), v0 = Math.floor(v), u1 = Math.min(gw - 1, u0 + 1), v1 = Math.min(gh - 1, v0 + 1), fu = u - u0, fv = v - v0;
    const i00 = v0 * gw + u0, i10 = v0 * gw + u1, i01 = v1 * gw + u0, i11 = v1 * gw + u1;
    const al = (A[i00] * (1 - fu) + A[i10] * fu) * (1 - fv) + (A[i01] * (1 - fu) + A[i11] * fu) * fv;
    if (al < 0.5) continue;
    const l = (L[i00] * (1 - fu) + L[i10] * fu) * (1 - fv) + (L[i01] * (1 - fu) + L[i11] * fu) * fv, d = 1 - l;
    const r = isK ? 0.5 * cell * 1.25 * Math.sqrt(clamp((d - 0.18) / 0.82)) : 0.5 * cell * 1.10 * Math.sqrt(clamp(0.10 + 0.85 * d));
    if (r < 0.35) continue;
    ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, 6.2832);
  }
  ctx.fill();
}
// redraw a plate's dot canvas only when its screen changed (a cache keyed on everything the drawing reads), then
// clip it to the silhouette: the dots end on the photo's own edge line
function register_screen(p, cv, kind, cell) {
  const key = (p.G ? 1 : 0) + '|' + cell.toFixed(3);
  if (cv._key === key) return;
  cv._key = key;
  const ctx = cv.getContext('2d'); ctx.clearRect(0, 0, cv.width, cv.height);
  register_dots(ctx, p.G, cell, kind === 'K' ? 45 : 15, kind, p.box, 24, kind === 'K' ? ALM.ink : p.ink);
  if (p.sil) { ctx.save(); ctx.globalCompositeOperation = 'destination-in'; ctx.drawImage(p.sil, 24 + p.box.x, 24 + p.box.y); ctx.restore(); }
}

// ── the prep: runs once, inside the layout ───────────────────────────────────────────────────────
function register_prep(p, img) {
  const b = p.box, pw = Math.ceil(b.w), ph = Math.ceil(b.h);
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high'; return [c, x]; };
  // the luma / alpha grid at 1/4 of the box (the downscale is the 1–2 px feather the spec asks for)
  const gw = Math.max(2, Math.round(b.w / 4)), gh = Math.max(2, Math.round(b.h / 4));
  const [, gx] = mk(gw, gh); gx.drawImage(img, 0, 0, gw, gh);
  const gd = gx.getImageData(0, 0, gw, gh).data, L = new Float32Array(gw * gh), A = new Float32Array(gw * gh);
  for (let i = 0; i < gw * gh; i++) {
    A[i] = gd[i * 4 + 3] / 255;
    L[i] = A[i] > 0 ? (0.299 * gd[i * 4] + 0.587 * gd[i * 4 + 1] + 0.114 * gd[i * 4 + 2]) / 255 : 1;
  }
  p.G = { L, A, w: gw, h: gh };
  // the silhouette, 1:1 with the box, CHOKED by 1 px (the alpha times itself shifted ±1 px on each axis): the key's
  // pale fringe goes, and the photo, its knock-outs, its screens and plate W's cut all share this one edge
  const [sil, sx] = mk(pw, ph);
  sx.drawImage(img, 0, 0, b.w, b.h);
  const [tmp, tx] = mk(pw, ph); tx.drawImage(sil, 0, 0);
  sx.globalCompositeOperation = 'destination-in';
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) sx.drawImage(tmp, dx, dy);
  sx.globalCompositeOperation = 'source-in'; sx.fillStyle = '#fff'; sx.fillRect(0, 0, pw, ph);
  p.sil = sil;
  for (const cv of [p.koM, p.koK]) cv.getContext('2d').drawImage(sil, 0, 0);
  // plate W's cut: a page-sized mask, opaque except the silhouette
  const [wm, wmx] = mk(W, H);
  wmx.fillStyle = '#fff'; wmx.fillRect(0, 0, W, H);
  wmx.globalCompositeOperation = 'destination-out'; wmx.drawImage(sil, b.x, b.y);
  const url = wm.toDataURL();
  const ms = p.Wp.pg.style;
  ms.webkitMaskImage = ms.maskImage = `url(${url})`;
  ms.webkitMaskSize = ms.maskSize = `${W}px ${H}px`;
  ms.webkitMaskRepeat = ms.maskRepeat = 'no-repeat';
  ms.webkitMaskPosition = ms.maskPosition = '0 0';
  // the continuous-tone duotone at 1.5x (ink → paper, the highlights tinted `duotone` toward the band ink)
  const R = 1.5, dw = Math.ceil(b.w * R), dh = Math.ceil(b.h * R);
  const dc = p.duo; dc.width = dw; dc.height = dh;
  const dx = dc.getContext('2d'); dx.imageSmoothingEnabled = true; dx.imageSmoothingQuality = 'high';
  dx.drawImage(img, 0, 0, dw, dh);
  const im = dx.getImageData(0, 0, dw, dh), px = im.data, duo = S.duotone == null ? 0.30 : clamp(+S.duotone);
  const lo = almHex(ALM.ink), pa = almHex(ALM.paper), mu = almHex(p.bandInk), hi = pa.map((v, i) => v + (mu[i] - v) * duo);
  for (let i = 0; i < px.length; i += 4) {
    const l = clamp(((0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) / 255 - 0.04) * 1.08);
    px[i] = lo[0] + (hi[0] - lo[0]) * l; px[i + 1] = lo[1] + (hi[1] - lo[1]) * l; px[i + 2] = lo[2] + (hi[2] - lo[2]) * l;
  }
  dx.putImageData(im, 0, 0);
  dx.globalCompositeOperation = 'destination-in'; dx.drawImage(sil, 0, 0, pw * R, ph * R); dx.globalCompositeOperation = 'source-over';
  // the frozen 7 px black screen: print texture that stays on the photo (multiply .13) and lifts with it
  const gh2 = p.ghost.getContext('2d');
  register_dots(gh2, p.G, 7, 45, 'K', { x: 0, y: 0, w: b.w, h: b.h }, 0, ALM.ink);
  gh2.globalCompositeOperation = 'destination-in'; gh2.drawImage(sil, 0, 0); gh2.globalCompositeOperation = 'source-over';
  p.ready = true;
}

// ── the layout: everything that depends on the photo's real shape ────────────────────────────────
function register_layout(p, meta, img) {
  const D0 = D, kap = clamp((D0 - 1.6) / 5.4, 0.45, 1), T = x => x * kap, m = S.misregister == null ? 1 : +S.misregister;
  const trim = S.trim !== false && D0 >= 5.0, lift = !!img && D0 >= 5.0, push = trim ? 1.015 : 1;
  const bandInk = S.band === 'yellow' ? ALM.yellow : ALM.mustard, ink = almUnder(bandInk, ALM.paper);
  const seed = p.seed, sheet = p.sheet;
  const prof = img ? register_profile(img) : null;
  const pl = img ? register_place(meta, prof, lift, push) : { box: { x: 1100, y: 40, w: 800, h: 1064 }, leftAt: () => 1806 };
  const box = pl.box, leftAt = pl.leftAt;
  const title = String(S.title == null ? '' : S.title).trim();
  const tw = ALM.wTitle, capK = almInk('H', 100, tw).cap / 100;

  // ── the type, measured flat (before any plate or page transform) ──
  // kicker: one line at 28 px down to a 22 px floor; below that, two balanced lines at 24 (or 22)
  const kt = S.kicker ? register_caps(S.kicker) : '';
  const KW = Math.min(1500, leftAt(40, 210) - 28 - 154);
  let kRows = [], ks = 28;
  if (kt) {
    ks = register_fit(kt, 28, 800, 0.16, KW);
    if (ks >= 22) kRows = [kt];
    else {
      for (const s of [24, 22]) { ks = s; kRows = almWrap(kt, s, 800, KW, 0.16); if (kRows.length <= 2) break; }
      if (kRows.length > 2) console.warn('register: kicker runs to ' + kRows.length + ' lines');
    }
  }
  const kLh = Math.round(ks * 1.2), kCap = almInk('H', ks, 800).cap, kGap = 50;
  // title: one row at 330 px within TW; a title with a space that would shrink under 240 px goes on two rows
  const rowTop1 = 430 - capK * 330;
  const TW1 = Math.min(1500, leftAt(rowTop1, 432) - 28 - 150);
  const s1 = title ? register_fit(title, 330, tw, -0.03, TW1) : 330;
  let rows = [title], g = { base: 430, pitch: 0, size: 330, w: tw, maxW: TW1 };
  if (s1 < 240 && /\s/.test(title)) {
    const words = title.split(/\s+/);
    let best = null;
    for (let k = 1; k < words.length; k++) {
      const r = [words.slice(0, k).join(' '), words.slice(k).join(' ')];
      const wmax = Math.max(...r.map(x => register_width(x, 100, tw, -0.03)));
      if (!best || wmax < best.wmax) best = { r, wmax };
    }
    const B2 = 436, topMin = kRows.length ? 56 + kCap + (kRows.length - 1) * kLh + kGap : 64;
    const sV = (B2 - topMin) / (0.9 + capK);
    const TW2 = Math.min(1500, leftAt(topMin, B2 + 2) - 28 - 150);
    const s2 = Math.min(250, sV, ...best.r.map(x => register_fit(x, 330, tw, -0.03, TW2)));
    if (s2 > s1 * 1.08) { rows = best.r; g = { base: B2 - Math.round(0.9 * s2), pitch: Math.round(0.9 * s2), size: s2, w: tw, maxW: TW2 }; }
  }

  // ── plates ──
  const plate = blend => {
    const el = document.createElement('div'); el.className = 'register-plate';
    if (blend) el.style.mixBlendMode = blend;
    el.style.opacity = 0;
    sheet.appendChild(el);
    const marks = document.createElement('div'); marks.className = 'register-marks'; el.appendChild(marks);
    return { el, marks, pg: register_page(el) };
  };
  // plate M: the band, its knock-out, the mustard screen; mustard marks and M patches
  const M = plate('multiply');
  M.marks.innerHTML = register_marks(ink) + register_patches(ink, [[0, 1], [1, 0.6], [2, 0.3], [6, 1]]);
  const band = almFill(M.pg, -24, -24, W + 48, 524, ink);
  const koM = register_canvas(M.pg, box.x, box.y, box.w, box.h);
  const dM = register_canvas(M.pg, -24, -24, W + 48, H + 48);
  // plate W: the paper-white trap under the title (its letters rise with K's), the silhouette masked out
  const Wp = plate(null);
  Wp.el.style.opacity = 1;
  const wtitle = register_title(Wp.pg, rows, g, '#FBFAF7');
  // plate K: stripe, title, kicker, subtitle, body, folio, the white knock-out, the black screen; black marks
  const K = plate('multiply');
  K.marks.innerHTML = register_marks(ALM.ink) + register_patches(ALM.ink, [[3, 1], [4, 0.6], [5, 0.3], [6, 1]]);
  const stripe = almFill(K.pg, -24, 500, W + 48, 92, ALM.bar);
  const titleH = register_title(K.pg, rows, g, ALM.ink);
  const capTop = g.base - capK * titleH.size;
  let kick = null;
  if (kRows.length) {
    const lastB = capTop - kGap;
    kick = fadeLines(K.pg, kRows.join('\n'), { x: 154, baseline: lastB - (kRows.length - 1) * kLh, w: 1800, size: ks, weight: 800, lh: kLh, ls: 0.16, color: ALM.ink });
  }
  // subtitle: one line at 46 down to a 36 px floor; below that, ≤ 2 balanced lines at 40 (or 36)
  let sub = null, subBottom = 612;
  if (S.subtitle) {
    const st = String(S.subtitle), SW = Math.min(880, leftAt(600, 760) - 40 - 154);
    let ss = register_fit(st, 46, 800, -0.01, SW), sRows = [st];
    if (ss < 36) {
      for (const s of [40, 36]) { ss = s; sRows = almWrap(st, s, 800, SW, -0.01); if (sRows.length <= 2) break; }
      if (sRows.length > 2) console.warn('register: subtitle runs to ' + sRows.length + ' lines');
    }
    const lh = Math.round(ss * 1.2);
    sub = fadeLines(K.pg, sRows.join('\n'), { x: 154, y: 636, w: 1800, size: ss, weight: 800, lh, ls: -0.01, color: ALM.ink });
    subBottom = 636 + sRows.length * lh;
  }
  // body: under the subtitle's real bottom, ≤ 3 lines. With a stamp the stamp slot must keep ≥ 170 px. What does
  // not fit is cut at a SENTENCE boundary (never mid-sentence: "sentenced him to eleven" would misinform), and the
  // body goes altogether when not even its first sentence fits.
  const slot = n => (n ? bodyTop + n * 44 : subBottom) + 28;
  let body = null, bodyN = 0;
  const bodyTop = subBottom + 21;
  if (S.body) {
    const sents = register_sentences(String(S.body)), bw = Math.min(860, leftAt(bodyTop, bodyTop + 132) - 40 - 154);
    for (let n = sents.length; n > 0 && !body; n--) {
      const h = fadeLines(K.pg, sents.slice(0, n).join(' '), { x: 154, y: bodyTop, w: bw, size: 28, weight: 500, lh: 44,
        color: 'rgba(21,21,21,.55)', shadow: '0 1px 0 rgba(255,255,255,.65),0 -1px 0 rgba(0,0,0,.10)' });
      if (h.lines.length <= 3 && (!S.stamp || 1004 - slot(h.lines.length) >= 170)) {
        body = h; bodyN = h.lines.length;
        if (n < sents.length) console.warn(`register: body cut to ${n} of ${sents.length} sentences`);
      } else h.el.remove();
    }
    if (!body) console.warn('register: body dropped (not one sentence fits' + (S.stamp ? ' beside the stamp)' : ')'));
  }
  // the folio: "SERIES · 09" from the optional S.series (the channel's name) and S.folio; never the kit's own name
  const folio = fadeLines(K.pg, [S.series ? String(S.series).toUpperCase() : '', S.folio || ''].filter(Boolean).join(' · '), { x: 154, baseline: 1032, w: 1200, size: 17, weight: 700, lh: 20, ls: 0.22, color: ALM.engraved });
  const koK = register_canvas(K.pg, box.x, box.y, box.w, box.h);
  const dK = register_canvas(K.pg, -24, -24, W + 48, H + 48);
  // stamp slot: the free paper between what was actually set and the folio
  const stTop = S.stamp ? slot(bodyN) : 0;

  // print texture: creases and hairline veins over bands and letters (below the photo)
  const texPg = register_page(sheet);
  const tex = register_canvas(texPg, -24, -24, W + 48, H + 48);
  paperTexture(tex, seed * 29 + 11, { veins: 4, creases: 2 });
  tex.style.opacity = 0.55;

  // the photograph: continuous-tone duotone + the frozen screen, one wrapper that lifts
  const phPg = register_page(sheet);
  const ph = document.createElement('div'); ph.className = 'register-photo';
  ph.style.cssText = `left:${almPx(box.x)};top:${almPx(box.y)};width:${almPx(box.w)};height:${almPx(box.h)};opacity:0`;
  phPg.appendChild(ph);
  const duo = register_canvas(ph, 0, 0, box.w, box.h); duo.style.width = almPx(box.w); duo.style.height = almPx(box.h);
  const ghost = register_canvas(ph, 0, 0, box.w, box.h); ghost.style.mixBlendMode = 'multiply'; ghost.style.opacity = 0.13;
  if (!img) ph.style.display = 'none';

  // timing
  const tM0 = Math.max(T(0.35), 0.30), dMt = tM0 - T(0.35);
  let l1 = T(4.55);
  const stampAt = S.stamp_at == null ? Math.max(lift ? l1 + 0.25 : T(3.95) + 0.3, D0 - 1.5) : +S.stamp_at;
  if (lift && S.stamp) l1 = Math.max(T(4.10), Math.min(l1, stampAt - 0.25));
  const l0 = l1 - T(0.55);

  // the stamp, centred in the free paper left of the photo, under what was set
  let stamp = null;
  if (S.stamp) {
    const stPg = register_page(sheet);
    const x0 = 154, x1 = Math.min(1766, leftAt(stTop, 1004) - 40), fitH = Math.min(240, 1004 - stTop);
    stamp = almStamp(stPg, { text: String(S.stamp), sub: S.stamp_sub ? String(S.stamp_sub) : '', rot: S.stamp_rot == null ? -7 : +S.stamp_rot,
      x: (x0 + x1) / 2, y: (stTop + 1004) / 2, fitW: x1 - x0, fitH, seed: seed * 131 + 1931 });
  }

  // the page layers go into the proof sheet only now: rise() above measured them flat
  for (const pg of sheet.querySelectorAll('.register-pg')) pg.style.transform = 'translate(128px,56px) scale(0.866667)';

  // the snaps: a ~5 px overshoot at misregister 1 for M and K, ~2 px for the small W move
  const cM = register_backC(5 / Math.hypot(28, 12)), cK = register_backC(5 / Math.hypot(20, 12)), cW = register_backC(0.16);
  Object.assign(p, { M, Wp, K, band, koM, dM, stripe, title: titleH, wtitle, kick, sub, body, folio, koK, dK, ph, duo, ghost,
    stamp, stampAt, box, ink, bandInk: ink, kap, T, m, cM, cK, cW, tM0, dMt, trim, lift, l0, l1, G: null, ready: !img });
  if (img) register_prep(p, img);
  p.laid = true;
}

SCENES.register = {
  build() {
    groundCharcoal(null, 0);                                              // no vignette: it would darken the page corners
    if (!document.getElementById('register-css')) {
      const st = document.createElement('style'); st.id = 'register-css';
      st.textContent = `.register-sheet{position:absolute;left:0;top:0;width:${W}px;height:${H}px;transform-origin:960px 524px}
      .register-plate{position:absolute;left:0;top:0;width:${W}px;height:${H}px;transform-origin:960px 540px}
      .register-pg{position:absolute;left:0;top:0;width:${W}px;height:${H}px;transform-origin:0 0;clip-path:inset(-24px)}
      .register-marks{position:absolute;left:0;top:0;width:${W}px;height:${H}px}
      .register-cv{position:absolute;display:block}
      .register-photo{position:absolute;isolation:isolate}`;
      document.head.appendChild(st);
    }
    const seed = (S.seed || 7) >>> 0, title = String(S.title == null ? '' : S.title).trim();
    // the camera: the proof sheet. Paper under grain is paperStock, like every other ALMANAC page.
    const sheet = document.createElement('div'); sheet.className = 'register-sheet'; scene.appendChild(sheet);
    const paper = almFill(sheet, -40, -40, W + 80, H + 80, ALM.paperStock);
    paperTexture(paper, seed * 17 + 3, { w: W + 80, h: H + 80, veins: 0, creases: 0, dust: 0.4, light: 0.5, grain: 1.2 });
    const furn = document.createElement('div'); furn.className = 'register-marks'; sheet.appendChild(furn);
    furn.innerHTML = register_outlines();
    const slug = document.createElement('div'); slug.className = 'abs';
    slug.style.cssText = `left:146px;top:${almPx(1044 - almBaseline(13, 600))};font-weight:600;font-size:13px;line-height:13px;letter-spacing:.18em;` +
      `color:${ALM.engraved};white-space:pre`;
    // the printer's slug: no kit name (it would print in every buyer's video) and no invented plate letters
    slug.textContent = `${S.series ? register_caps(S.series) + ' ' : ''}PROOF · ${register_caps(S.slug || title)} · 175 LPI`;
    furn.appendChild(slug);
    shutterBuild(scene);
    parts = { laid: false, sheet, furn, seed };
    // everything else waits for the cut-out: its alpha decides the placement and the type budget
    const meta = almCut(S.media);
    if (meta.src) {
      const img = new Image(); img.decoding = 'sync'; img.src = meta.src;
      // a picture the browser cannot decode lays the page out without it (a rejected decode would fail the batch)
      almHoldReady(img.decode().then(() => img, () => {
        console.warn('register: the photo cannot be decoded; the page is laid out without it'); return null;
      }).then(im => register_layout(parts, meta, im)));
    } else register_layout(parts, meta, null);
  },

  frame(t) {
    const p = parts, tS = almSharp(t);                                   // tS: whole frames, like the references
    shutter(tS);                                                          // 0 → 0.6 s, not scaled
    if (!p.laid) return;
    const T = p.T, m = p.m;
    // plate M: lands at full ink (no ink fades in) far off, flies to a near miss, snaps into register; the band
    // wipes down meanwhile
    const oM = register_off(t, p.tM0, T(0.80) + p.dMt, T(1.05) + p.dMt, [-300 * m, -140 * m, -2.6 * m], [-28 * m, -12 * m, -0.4 * m], p.cM);
    p.M.el.style.transform = `translate(${oM[0].toFixed(2)}px,${oM[1].toFixed(2)}px) rotate(${oM[2].toFixed(4)}deg)`;
    p.M.el.style.opacity = tS >= p.tM0 ? 1 : 0;
    bandWipe(p.band, ease3(tS, p.tM0, T(0.40)), 'down');
    // plate K: the same, the stripe grows from the right edge, the title rises riding the plate
    const oK = register_off(t, T(0.95), T(1.40), T(1.70), [260 * m, 170 * m, 2.0 * m], [20 * m, 12 * m, 0.3 * m], p.cK);
    p.K.el.style.transform = `translate(${oK[0].toFixed(2)}px,${oK[1].toFixed(2)}px) rotate(${oK[2].toFixed(4)}deg)`;
    p.K.el.style.opacity = tS >= T(0.95) ? 1 : 0;
    bandWipe(p.stripe, ease3(tS, T(0.95), T(0.30)), 'left');
    riseLinesFrame(p.title, tS, T(1.15));
    // plate W: its white letters rise under the black ones, off register (14, 12, +.5°)·m, and snap to the
    // (+3, +3) trap (page px → sheet px)
    riseLinesFrame(p.wtitle, tS, T(1.15));
    const eW = register_back(seg(t, T(1.26), T(1.45)), p.cW);
    const wx = (3 + (14 * m - 3) * (1 - eW)) * 0.866667, wy = (3 + (12 * m - 3) * (1 - eW)) * 0.866667, wr = 0.5 * m * (1 - eW);
    p.Wp.el.style.transform = `translate(${wx.toFixed(2)}px,${wy.toFixed(2)}px) rotate(${wr.toFixed(4)}deg)`;
    const q = ease3(tS, T(1.55), T(0.30));
    for (const h of [p.kick, p.sub]) if (h) { fadeLinesFrame(h, tS, T(1.55), 0, T(0.30), 3); h.el.style.transform = q >= 1 ? 'none' : `translate3d(0,${((1 - q) * 10).toFixed(2)}px,0)`; }
    // the screens: 44 → 7 px (geometric, eo3); they fade out under the resolving photo once it is mostly opaque,
    // then they and the knock-outs go. Every page layer is clipped to the 24 px bleed (CSS), as a printed sheet is.
    const rv = smooth(seg(tS, T(2.55), T(3.05)));
    const cell = 44 * Math.pow(7 / 44, eo3(seg(tS, T(0.95), T(2.55))));
    const onM = p.ready && tS >= p.tM0 && rv < 1, onK = p.ready && tS >= T(0.95) && rv < 1;
    p.dM.style.display = onM ? 'block' : 'none'; p.dK.style.display = onK ? 'block' : 'none';
    p.dM.style.opacity = p.dK.style.opacity = (1 - smooth(seg(rv, 0.6, 1))).toFixed(4);   // gone under a ≥ 60 % photo
    if (onM) register_screen(p, p.dM, 'M', cell);
    if (onK) register_screen(p, p.dK, 'K', cell);
    p.koM.style.display = p.koK.style.display = rv < 1 ? 'block' : 'none';
    // the photo resolves; after the trim it peels up off the page (smoothstep: it follows a camera that has just
    // come to rest, and an eo3 start at 3x speed read as a kick)
    p.ph.style.opacity = rv.toFixed(4);
    const L = register_LIFT;
    almLift(p.ph, p.lift ? smooth(seg(t, p.l0, p.l1)) : 0, { shadow: L.shadow, scale: L.scale, dx: L.dx, dy: L.dy, rot: L.rot });
    // body lines and the folio
    if (p.body) fadeLinesFrame(p.body, tS, T(3.70), 0.12, 0.30, 3);
    fadeLinesFrame(p.folio, tS, T(3.90), 0, T(0.40), 3);
    // the stamp comes down; the page jolts on impact
    let jolt = 0;
    if (p.stamp) { const tl = p.stamp.frame(tS, p.stampAt); jolt = almJolt(t, [tl], 5, 6, 16, 'cos'); }
    // the camera: trim the proof down to the page, then a slow push over the hold
    const tq = p.trim ? smooth(seg(t, T(3.10), T(3.90))) : 0;
    const push = 1 + (p.trim ? 0.015 : 0.01) * smooth(seg(t, T(3.90), D));
    const sc = (1 + 0.153846 * tq) * push, ty = 16 * tq + jolt;
    p.sheet.style.transform = (sc === 1 && ty === 0) ? 'none' : `translate3d(0,${ty.toFixed(2)}px,0) scale(${sc.toFixed(5)})`;
    // the furniture is outside the frame once the trim has landed: take it out of the render
    const marks = tq >= 1 ? 'none' : 'block';
    p.furn.style.display = p.M.marks.style.display = p.K.marks.style.display = marks;
  },
};
