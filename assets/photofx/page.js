/* PHOTO FX — the two scenes it draws in Chromium.

   SCENE.type "spotlight": a real photograph. The camera pushes in on the subject while the rest of the
   picture darkens, loses its colour and blurs; the subject, cut out, stays sharp and grows a little.
   SCENE.type "objects": real things cut out of their photos, flying in over a blurred ground with a
   soft shadow under each — rise and settle, drop and wobble, slide in from a side, or pop.

   Every frame is a screenshot taken at time t, in any order: everything below is computed from t alone. */
(function () {
  const S = window.SCENE;
  const FW = 1920, FH = 1080;
  const cl = (x, a, b) => Math.max(a, Math.min(b, x));
  const seg = (t, s, d) => cl((t - s) / Math.max(1e-6, d), 0, 1);
  const lerp = (a, b, p) => a + (b - a) * p;
  const eOut = p => 1 - Math.pow(1 - p, 3);
  const eInOut = p => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
  const eBack = p => { const c1 = 1.9, c3 = c1 + 1; return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2); };
  // a damped spring from 0 to 1: f = how many swings a second, z = how quickly they die (0..1)
  function spring(t, f, z) {
    if (t <= 0) return 0;
    const w = 2 * Math.PI * f, wd = w * Math.sqrt(1 - z * z);
    return 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + (z * w / wd) * Math.sin(wd * t));
  }

  const root = document.getElementById('stage');
  const waits = [];
  function el(tag, cls, parent) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    (parent || root).appendChild(e);
    return e;
  }
  function pic(src, cls, parent, w, h) {
    const i = el('img', cls, parent);
    waits.push(new Promise(res => { i.onload = i.onerror = res; }));
    i.src = src;
    if (w) { i.style.width = w + 'px'; i.style.height = h + 'px'; }
    return i;
  }
  const show = (e, on) => { const v = on ? 'visible' : 'hidden'; if (e.style.visibility !== v) e.style.visibility = v; };
  let frame = () => {};

  if (S.type === 'spotlight') {
    // two cameras with the same move: the picture, then the vignette, then the subject above both —
    // so the darkening at the edges never touches the subject
    const cam = el('div', 'cam');
    const plate = pic(S.plate, 'layer', cam, S.cw, S.ch);
    const dim = pic(S.dim, 'layer', cam, S.cw, S.ch);
    const soft = pic(S.soft, 'layer', cam, S.cw, S.ch);
    const vig = el('div', 'vig');
    const cam2 = el('div', 'cam');
    let subj = null;
    if (S.subj) {
      subj = pic(S.subj, 'layer', cam2, S.cw, S.ch);
      subj.style.transformOrigin = `${S.anchor[0]}px ${S.anchor[1]}px`;
    }
    frame = t => {
      const D = S.duration, hit = S.hit;
      // a slow push from the first frame, then the real move toward the subject
      const move = eInOut(seg(t, 0.1, D - 0.1));
      const z = 1 + S.creep * seg(t, 0, D) + (S.zoom - 1 - S.creep) * move;
      const s = (FW / S.cw) * z;
      const pan = eInOut(seg(t, 0, D * 0.85));
      const hw = FW / (2 * s), hh = FH / (2 * s);
      const cx = cl(lerp(S.cw / 2, S.focus[0], pan), hw, S.cw - hw);
      const cy = cl(lerp(S.ch / 2, S.focus[1], pan), hh, S.ch - hh);
      cam.style.transform = cam2.style.transform =
        `translate(${FW / 2}px,${FH / 2}px) scale(${s}) translate(${-cx}px,${-cy}px)`;
      const d = eInOut(seg(t, hit - 0.35, 1.1));
      const f = eInOut(seg(t, hit + 0.45, 1.6));
      dim.style.opacity = d;
      soft.style.opacity = f;
      // a layer fully covered by an opaque one above it is not drawn at all (without a cutout the
      // darker layers carry an oval of light, so the sharp picture must stay underneath)
      show(plate, !S.opaque || d < 0.999);
      show(dim, d > 0.001 && f < 0.999);
      show(soft, f > 0.001);
      if (subj) subj.style.transform = `scale(${lerp(1, S.pop, eOut(seg(t, hit - 0.2, 2.4)))})`;
      vig.style.opacity = S.vignette * d;
    };
  }

  if (S.type === 'objects') {
    const ground = el('div', 'ground');
    const bg = pic(S.bg, 'bg', ground, FW, FH);
    const world = el('div', 'world');
    const rows = S.items.map((it, i) => ({
      it,
      sh: pic(it.shadow, 'thing', world, it.sw, it.sh),
      im: pic(it.src, 'thing', world, it.w, it.h),
      phase: 0.9 + i * 1.7,
    }));
    for (const r of rows) r.im.style.transformOrigin = r.it.enter === 'drop' ? '50% 100%' : '50% 50%';
    let label = null;
    if (S.label && S.label.text) {
      label = el('div', 'label', root);
      label.textContent = S.label.text;
      label.style.left = S.label.x + 'px';
      label.style.top = S.label.y + 'px';
    }

    // where a thing is `u` seconds after it starts to enter: {x, y, rot, sc, lift}; lift 0 = at rest
    function move(it, u, phase) {
      let x = it.x, y = it.y, rot = 0, sc = 1, lift = 0;
      if (it.enter === 'drop') {
        const fall = 0.4;
        if (u < fall) {
          const p = u / fall;
          y = lerp(-it.h * 0.75, it.y, p * p);
          rot = it.rot * (1 - 0.35 * p);
          lift = 1 - p * p;
        } else {
          const v = u - fall;
          const hop = Math.abs(Math.sin(v * 9.0)) * Math.exp(-v * 7.0);
          y = it.y - hop * it.h * 0.07;
          rot = it.rot * 0.65 * Math.exp(-v * 3.4) * Math.cos(v * 12.5);
          lift = hop * 0.35;
        }
      } else if (it.enter === 'pop') {
        const p = seg(u, 0, 0.5);
        sc = Math.max(0.001, eBack(p));
        rot = it.rot * (1 - eOut(p));
        lift = 1 - p;
      } else {
        const k = spring(u, 1.05, 0.6);
        const r = spring(u, 0.85, 0.45);
        if (it.enter === 'left' || it.enter === 'right') {
          const from = it.enter === 'left' ? -it.w * 0.7 : FW + it.w * 0.7;
          x = lerp(from, it.x, k);
          y = it.y + (1 - k) * it.h * 0.12;
        } else {
          y = lerp(FH + it.h * 0.65, it.y, k);
        }
        rot = it.rot * (1 - r);
        sc = lerp(0.9, 1, cl(k, 0, 1.3));
        lift = cl(1 - k, 0, 1);
      }
      // once it has settled, it keeps breathing a little
      const idle = seg(u, 0.9, 0.9);
      y += idle * it.h * 0.006 * Math.sin(u * 2 * Math.PI / 3.3 + phase);
      rot += idle * 0.6 * Math.sin(u * 2 * Math.PI / 4.4 + phase);
      return { x, y, rot, sc, lift };
    }

    frame = t => {
      const D = S.duration;
      bg.style.transform = `scale(${lerp(1.12, 1.02, eOut(seg(t, 0, D)))})`;
      world.style.transform = `scale(${lerp(1.0, 1.045, eInOut(seg(t, 0, D)))})`;
      for (const r of rows) {
        const it = r.it, u = t - it.at;
        const on = u > 0;
        show(r.im, on);
        show(r.sh, on);
        if (!on) continue;
        const m = move(it, u, r.phase);
        r.im.style.transform = `translate(${m.x - it.w / 2}px,${m.y - it.h / 2}px) rotate(${m.rot}deg) scale(${m.sc})`;
        const lift = cl(m.lift, 0, 1);
        const sx = m.x + it.dx * (1 + 1.5 * lift), sy = m.y + it.dy + lift * it.h * 0.25;
        r.sh.style.transform = `translate(${sx - it.sw / 2}px,${sy - it.sh / 2}px) rotate(${m.rot}deg) scale(${m.sc * (1 + 0.3 * lift)})`;
        r.sh.style.opacity = S.shadow * (1 - 0.75 * lift);
      }
      if (label) {
        const p = eOut(seg(t, S.label.at, 0.45));
        label.style.clipPath = `inset(0 ${100 - 100 * p}% 0 0)`;
        show(label, p > 0);
      }
    };
  }

  if (S.type === 'strip') {
    // A strip of 35 mm film lying across the frame: the photo in the middle frame, its neighbours either side,
    // sprocket holes above and below, the edge print between them. The camera lands on the first photo with a
    // quick zoom-out (under a second, fast then soft) and a light leak; on every change the strip slides one
    // frame while the camera punches in and out again, another leak flashes and a click lands (strip_marks).
    // The whole scene moves at a low frame rate — the flicker of a projector — except the leaks.
    const FPS = S.fps || 15;
    const q = t => Math.floor(t * FPS + 1e-6) / FPS;
    const FRW = 1180, FRH = 787, GAP = 74, STEP = FRW + GAP, HOLE = 56, HOLEH = 40;
    const n = S.frames.length;
    const cam = el('div', 'cam');
    cam.style.transformOrigin = '0 0';
    const strip = el('div', '', cam);
    Object.assign(strip.style, { position: 'absolute', left: (-2 * STEP) + 'px', top: ((FH - FRH) / 2 - 150) + 'px', height: (FRH + 300) + 'px', width: (STEP * (n + 4)) + 'px', background: '#050505' });
    const x0 = (FW - FRW) / 2 + 2 * STEP;                    // the first photo's frame, centred on screen at slide 0
    // two blank exposures either side of the photos: a strip is never only three frames long
    for (let k = -2; k < n + 2; k++) {
      const fx = x0 + k * STEP, fy = 150;
      const f = el('div', '', strip);
      Object.assign(f.style, { position: 'absolute', left: fx + 'px', top: fy + 'px', width: FRW + 'px', height: FRH + 'px', background: '#111214', overflow: 'hidden' });
      if (k >= 0 && k < n) {
        const im = pic(S.frames[k], '', f, FRW, FRH);
        Object.assign(im.style, { position: 'absolute', left: '0', top: '0', filter: 'contrast(1.02) brightness(.98)' });
      } else {
        f.style.background = 'linear-gradient(135deg,#17181a 0%,#0e0f10 60%,#131416 100%)';
      }
      // the frame number under it and the edge print above, like a real contact print
      const num = S.start + k, sub = k % 2 ? 'A' : '';
      const lab = el('div', '', strip);
      lab.textContent = `${num}${sub}`;
      Object.assign(lab.style, { position: 'absolute', left: (fx + FRW - 8) + 'px', top: (fy + FRH + 62) + 'px', font: '600 26px "Inter", Arial, sans-serif', color: 'rgba(230,224,210,.78)', letterSpacing: '.08em', transform: 'translateX(-100%)' });
      const code = el('div', '', strip);
      code.textContent = k % 2 === 0 ? S.code : `${S.code.split(' ')[0]}  SAFETY  FILM`;
      Object.assign(code.style, { position: 'absolute', left: (fx + 26) + 'px', top: (fy - 96) + 'px', font: '700 26px "Inter", Arial, sans-serif', color: 'rgba(232,226,212,.82)', letterSpacing: '.12em' });
      const arrow = el('div', '', strip);
      arrow.textContent = '▶';
      Object.assign(arrow.style, { position: 'absolute', left: (fx + FRW / 2 - 8) + 'px', top: (fy + FRH + 64) + 'px', font: '22px Arial, sans-serif', color: 'rgba(230,224,210,.7)' });
    }
    // sprocket holes: a row above and below, evenly along the strip
    for (let x = 20; x < STEP * (n + 4); x += 96) {
      for (const y of [150 - HOLEH - 22, 150 + FRH + 22]) {
        const h = el('div', '', strip);
        Object.assign(h.style, { position: 'absolute', left: x + 'px', top: y + 'px', width: HOLE + 'px', height: HOLEH + 'px', borderRadius: '9px', background: '#1b1c1e', boxShadow: 'inset 0 0 0 2px #000, inset 0 2px 6px rgba(255,255,255,.06)' });
      }
    }
    // the light leak: a warm blob that flashes over the picture on every change (screen blend, black = nothing)
    const leak = el('div', 'layer');
    Object.assign(leak.style, { width: FW + 'px', height: FH + 'px', mixBlendMode: 'screen', pointerEvents: 'none', opacity: '0',
      background: 'radial-gradient(ellipse 60% 90% at 78% 30%, rgba(255,150,40,.95) 0%, rgba(255,70,20,.55) 35%, rgba(120,20,0,0) 70%), radial-gradient(ellipse 45% 70% at 12% 80%, rgba(255,200,90,.6) 0%, rgba(0,0,0,0) 60%)' });
    const vig = el('div', 'vig');
    vig.style.opacity = '0.55';
    const eOutQ = p => 1 - Math.pow(1 - p, 5);
    frame = tt => {
      const t = q(tt), D = S.duration;
      // which photo is on, and the slide toward it (an eased 0.42 s move of one frame width)
      let slide = 0, punch = 0, leakA = 0;
      for (let k = 1; k < n; k++) {
        const a = S.at[k];
        slide += eInOut(seg(t, a, 0.42));
        const u = tt - a;
        if (u >= 0) { punch = Math.max(punch, 0.16 * Math.sin(Math.PI * cl(u / 0.5, 0, 1)) * (1 - 0.35 * cl(u / 0.5, 0, 1))); leakA = Math.max(leakA, 0.85 * (1 - eOut(cl(u / 0.55, 0, 1)))); }
      }
      // the landing: from 1.55x down to 1.0 in 0.7 s, fast then soft — the first leak flashes with it
      const land = eOutQ(seg(t, 0, 0.7));
      leakA = Math.max(leakA, 0.8 * (1 - eOut(cl(tt / 0.6, 0, 1))));
      const drift = 1 + 0.05 * seg(t, 0, D) + 0.004 * Math.sin(t * 1.7);
      const z = (1.55 - 0.55 * land) * (1 + punch) * drift;
      const cx = FW / 2 + Math.sin(t * 0.9) * 6, cy = FH / 2 + Math.cos(t * 0.7) * 4;
      cam.style.transform = `translate(${cx}px,${cy}px) scale(${z}) translate(${-FW / 2 - slide * STEP}px,${-FH / 2}px)`;
      leak.style.opacity = leakA.toFixed(3);
      // out: the picture fades in its last third of a second
      cam.style.opacity = vig.style.opacity = (1 - seg(tt, D - 0.3, 0.3)).toFixed(3);
    };
  }

  if (S.type === 'matchcut') {
    // A run of real photographs of one person, cut fast: every face lands on the same spot of the screen at the
    // same size (the picture scaled and moved so its face box meets the target), a white flash and a shutter on
    // every cut, each photo pushing in a little while it is up, the last one held with a slow push and a fade.
    const T = S.face || { cx: 0.5, cy: 0.44, h: 0.36 };
    const tx = T.cx * FW, ty = T.cy * FH, th = T.h * FH;
    const cam = el('div', 'cam');
    const layers = S.photos.map(p => {
      const lay = el('div', 'layer', cam);
      Object.assign(lay.style, { width: FW + 'px', height: FH + 'px', overflow: 'hidden', visibility: 'hidden', transformOrigin: `${tx}px ${ty}px`, background: '#000' });
      const bx = (p.box[0] + p.box[2]) / 2 * p.w, by = (p.box[1] + p.box[3]) / 2 * p.h, bh = (p.box[3] - p.box[1]) * p.h;
      const sc = th / bh;
      // a tight portrait scaled to the face leaves the frame's edges empty: the same photo, blown up and blurred,
      // sits behind it so the frame is never black
      const cover = Math.max(FW / p.w, FH / p.h) * 1.15;
      if (p.w * sc < FW || p.h * sc < FH) {
        const bg = pic(p.src, '', lay, p.w * cover, p.h * cover);
        Object.assign(bg.style, { position: 'absolute', left: ((FW - p.w * cover) / 2) + 'px', top: ((FH - p.h * cover) / 2) + 'px', width: (p.w * cover) + 'px', height: (p.h * cover) + 'px', filter: 'blur(28px) brightness(.55) saturate(.8)' });
      }
      const im = pic(p.src, '', lay, p.w * sc, p.h * sc);
      Object.assign(im.style, { position: 'absolute', left: (tx - bx * sc) + 'px', top: (ty - by * sc) + 'px', width: (p.w * sc) + 'px', height: (p.h * sc) + 'px', boxShadow: '0 0 60px rgba(0,0,0,.6)' });
      return lay;
    });
    const flash = el('div', 'layer');
    Object.assign(flash.style, { width: FW + 'px', height: FH + 'px', background: '#fff', opacity: '0', pointerEvents: 'none' });
    const vig = el('div', 'vig');
    // the landmark run (S.mode "landmark") has no flash, no vignette and ends on a hard cut (measured on STRATA's reference)
    const vigA = S.vignette != null ? +S.vignette : 0.5, flashA = S.flash === false ? 0 : 0.92;
    const fadeOut = S.fade_out != null ? +S.fade_out : 0.3;
    vig.style.opacity = String(vigA);
    const n = S.photos.length;
    frame = t => {
      const D = S.duration;
      let k = -1;
      for (let i = 0; i < n; i++) if (t >= S.at[i]) k = i;
      let fl = 0;
      layers.forEach((lay, i) => {
        const on = i === k;
        show(lay, on);
        if (on) {
          const since = t - S.at[i], last = i === n - 1;
          const hold = last ? Math.max(0.6, D - S.at[i]) : (S.at[i + 1] - S.at[i]);
          const push = last ? 1.0 + 0.07 * eOut(seg(since, 0, hold)) : 1.0 + 0.045 * (since / hold);
          lay.style.transform = `scale(${push})`;
          fl = Math.max(fl, flashA * (1 - eOut(seg(since, 0, 0.13))));   // the white flash of the cut
        }
      });
      if (k < 0) fl = 0;
      flash.style.opacity = fl.toFixed(3);
      const op = k < 0 ? 0 : (fadeOut > 0 ? 1 - seg(t, D - fadeOut, fadeOut) : 1);
      cam.style.opacity = op.toFixed(3);
      vig.style.opacity = (S.vignette != null ? vigA * op : op).toFixed(3);   // unchanged for the face run
    };
  }

  if (S.type === 'textcut') {
    // The text match cut: the words that hit, one line per hard cut, every line snapping onto the same spot of the
    // screen while the real photo behind it changes; a white flash on the cut, a chroma split that snaps shut, a
    // slow push on every picture, the last line held.
    const cam = el('div', 'cam');
    const layers = S.photos.map(p => {
      const lay = el('div', 'layer', cam);
      Object.assign(lay.style, { width: FW + 'px', height: FH + 'px', overflow: 'hidden', visibility: 'hidden', transformOrigin: '50% 50%', background: '#000' });
      const cover = Math.max(FW / p.w, FH / p.h);
      const im = pic(p.src, '', lay, p.w * cover, p.h * cover);
      Object.assign(im.style, { position: 'absolute', left: ((FW - p.w * cover) / 2) + 'px', top: ((FH - p.h * cover) / 2) + 'px', width: (p.w * cover) + 'px', height: (p.h * cover) + 'px', filter: 'brightness(.62) saturate(.85)' });
      return lay;
    });
    const shade = el('div', 'layer');
    Object.assign(shade.style, { width: FW + 'px', height: FH + 'px', background: 'linear-gradient(90deg, rgba(0,0,0,.55) 0%, rgba(0,0,0,.25) 55%, rgba(0,0,0,.05) 100%)', pointerEvents: 'none' });
    const box = el('div', 'layer');
    Object.assign(box.style, { left: '132px', top: '0', height: FH + 'px', width: '1500px', display: 'flex', flexDirection: 'column', justifyContent: 'center', pointerEvents: 'none' });
    const rule = el('div', '', box);
    Object.assign(rule.style, { height: '5px', width: '0px', background: '#F26D21', marginBottom: '28px' });
    const wrap = el('div', '', box);
    Object.assign(wrap.style, { position: 'relative' });
    const mk = (color, blend) => { const d = el('div', '', wrap); Object.assign(d.style, { position: 'absolute', left: '0', top: '0', font: '900 150px "Inter Display", "Inter", Arial, sans-serif', letterSpacing: '-.015em', lineHeight: '1', textTransform: 'uppercase', whiteSpace: 'nowrap', color, mixBlendMode: blend || 'normal', textShadow: '0 4px 30px rgba(0,0,0,.6)' }); return d; };
    const gr = mk('rgba(255,40,40,.75)', 'screen'), gc = mk('rgba(40,220,255,.75)', 'screen'), txt = mk('#FFFFFF');
    txt.style.position = 'relative';
    const flash = el('div', 'layer');
    Object.assign(flash.style, { width: FW + 'px', height: FH + 'px', background: '#fff', opacity: '0', pointerEvents: 'none' });
    const vig = el('div', 'vig');
    vig.style.opacity = '0.45';
    const n = S.lines.length;
    frame = t => {
      const D = S.duration;
      let k = -1;
      for (let i = 0; i < n; i++) if (t >= S.at[i]) k = i;
      const since = k >= 0 ? t - S.at[k] : 0;
      layers.forEach((lay, i) => {
        const on = k >= 0 && i === (k % layers.length);
        show(lay, on);
        if (on) lay.style.transform = `scale(${1.0 + 0.05 * Math.min(1, since / (k === n - 1 ? Math.max(0.6, D - S.at[k]) : 0.8))})`;
      });
      const line = k >= 0 ? S.lines[k] : '';
      for (const d of [gr, gc, txt]) d.textContent = line;
      const size = line.length > 14 ? 96 : line.length > 9 ? 124 : 150;
      for (const d of [gr, gc, txt]) d.style.fontSize = size + 'px';
      const pop = 1 + 0.16 * (1 - eOut(seg(since, 0, 0.18)));          // the line lands: a quick settle from 1.16
      const g = 1 - eOut(seg(since, 0, 0.22));                          // the chroma split snapping shut
      txt.style.transform = `scale(${pop})`; txt.style.transformOrigin = '0 50%';
      gr.style.transform = `translate(${-14 * g}px, 0) scale(${pop})`; gc.style.transform = `translate(${14 * g}px, 0) scale(${pop})`;
      gr.style.transformOrigin = gc.style.transformOrigin = '0 50%';
      gr.style.opacity = gc.style.opacity = (g > 0.02 ? g : 0).toFixed(3);
      rule.style.width = (110 * eOut(seg(t, S.at[0] - 0.05, 0.4))) + 'px';
      box.style.opacity = k >= 0 ? '1' : '0';
      flash.style.opacity = (k >= 0 ? 0.85 * (1 - eOut(seg(since, 0, 0.12))) : 0).toFixed(3);
      cam.style.opacity = vig.style.opacity = shade.style.opacity = (k < 0 ? 0 : 1 - seg(t, D - 0.3, 0.3)).toFixed(3);
      box.style.opacity = (k < 0 ? 0 : 1 - seg(t, D - 0.3, 0.3)).toFixed(3);
    };
  }

  if (S.type === 'tilt') {
    // a tall real photo filling the width of the frame: the camera starts at the top and travels down to the
    // subject, with a slow push — a portrait read from the hair to the hands
    const cam = el('div', 'cam');
    const plate = pic(S.plate, 'layer', cam, S.cw, S.ch);
    const vig = el('div', 'vig');
    vig.style.opacity = '0.5';
    frame = t => {
      const D = S.duration;
      const s0 = FW / S.cw;                                 // fit the width
      const z = 1.02 + 0.07 * eInOut(seg(t, 0, D));
      const s = s0 * z;
      const hv = FH / s;                                     // the frame's height in plate pixels
      const yEnd = cl(S.focus_y * S.ch - hv * 0.5, 0, S.ch - hv);
      const y = lerp(0, yEnd, eInOut(seg(t, 0.15, D - 0.5)));
      const x = (S.cw - FW / s) / 2;
      cam.style.transform = `scale(${s}) translate(${-x}px,${-y}px)`;
      cam.style.opacity = (1 - seg(t, D - 0.3, 0.3)).toFixed(3);
    };
  }

  const fonts = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
  Promise.all(waits.concat([fonts]))
    .then(() => Promise.all(Array.from(document.images).map(i => (i.decode ? i.decode().catch(() => null) : null))))
    .then(() => {
      window.renderFrame = t => frame(t);
      frame(0);
      window.__ready = true;
    });
})();
