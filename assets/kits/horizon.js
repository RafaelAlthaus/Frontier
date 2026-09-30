// HORIZON — the data documentary. Real numbers, drawn big and calm on a near-black navy: the line a country draws while
// the camera follows its pen, a population pyramid turning over, generations shrinking row by row, a figure that rolls
// like an odometer, the real document on the table with its translation, a quote typed with the voice.
// Every scene times itself on its own duration D; the numbers arrive filled in by horizon.py (World Bank, UN WPP).
// One serif (Playfair Display) for what is said, one sans (Poppins) for labels and sources; red is the one accent.

const SM = p => p * p * (3 - 2 * p), EO2 = p => 1 - (1 - p) * (1 - p);
const HRED = '#E0434C', HAMB = '#F2B84B', HINK = '#F4F1EA', HNAVY = '#070E14';
const SVGNS = 'http://www.w3.org/2000/svg';
function hEl(tag, css, parent, html) {
  const e = document.createElement(tag);
  if (css) e.style.cssText = css;
  if (html != null) e.innerHTML = html;
  (parent || scene).appendChild(e);
  return e;
}
function hSvg(parent) {
  const s = document.createElementNS(SVGNS, 'svg');
  s.setAttribute('width', W); s.setAttribute('height', H); s.setAttribute('viewBox', `0 0 ${W} ${H}`);
  s.style.cssText = 'position:absolute;left:0;top:0;overflow:visible';
  parent.appendChild(s);
  return s;
}
function hSv(tag, attrs, parent) {
  const e = document.createElementNS(SVGNS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  parent.appendChild(e);
  return e;
}
const _hg = {};
function hGrain(size = 256, amp = 30) {
  const key = size + '_' + amp;
  if (_hg[key]) return _hg[key];
  const c = document.createElement('canvas'); c.width = c.height = size; const x = c.getContext('2d');
  const im = x.createImageData(size, size); let s = 99991;
  for (let i = 0; i < im.data.length; i += 4) { s = (s * 16807) % 2147483647; const v = 128 + ((s & 255) - 128) * amp / 128; im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 255; }
  x.putImageData(im, 0, 0);
  return (_hg[key] = c.toDataURL());
}
// the ground: a colour with overlay grain (texture without lifting the blacks) and a heavy vignette
function hGround(holder, kind = 'navy', v = .72) {
  const col = { navy: HNAVY, maroon: '#260C15', black: '#050505', paper: '#E8E4DC' }[kind] || kind;
  const dark = kind !== 'paper';
  const g = hEl('div', `position:absolute;inset:0;overflow:hidden;background:${col}`, holder);
  hEl('div', `position:absolute;inset:0;background-image:url(${hGrain(256, dark ? 44 : 50)});opacity:${dark ? .32 : .5};mix-blend-mode:overlay`, g);
  hEl('div', `position:absolute;inset:0;background:radial-gradient(ellipse 72% 70% at 50% 50%, rgba(0,0,0,0) 45%, ${dark ? `rgba(0,0,0,${v})` : 'rgba(40,30,20,.55)'} 100%)`, g);
  return g;
}
function hCam(keys, t, ease) {
  let a = keys[0], b = keys[keys.length - 1];
  if (t <= a.t) return a; if (t >= b.t) return b;
  for (let i = 0; i < keys.length - 1; i++) if (t >= keys[i].t && t <= keys[i + 1].t) { a = keys[i]; b = keys[i + 1]; break; }
  const e = b.e || ease || 'smooth';
  const f = e === 'linear' ? (x => x) : e === 'eo3' ? eo3 : e === 'eio3' ? eio3 : SM;
  const p = f(seg(t, a.t, b.t));
  const o = {}; for (const k in a) if (typeof a[k] === 'number') o[k] = lerp(a[k], b[k] ?? a[k], p);
  return o;
}
function hKey(keys, t) {
  if (t <= keys[0].t) return keys[0].v;
  for (let i = 0; i < keys.length - 1; i++)
    if (t <= keys[i + 1].t) return lerp(keys[i].v, keys[i + 1].v, (keys[i + 1].e === 'linear' ? (x => x) : keys[i + 1].e === 'eio3' ? eio3 : SM)(seg(t, keys[i].t, keys[i + 1].t)));
  return keys[keys.length - 1].v;
}
function hCamXY(el, c) { el.style.transform = `translate(${960 - c.cx * c.s}px,${540 - c.cy * c.s}px) scale(${c.s})`; }
function hGlow(defs, id, sd = 8) {
  const f = hSv('filter', { id, x: '-50%', y: '-50%', width: '200%', height: '200%' }, defs);
  hSv('feGaussianBlur', { stdDeviation: sd, result: 'b' }, f);
  const m = hSv('feMerge', {}, f); hSv('feMergeNode', { in: 'b' }, m); hSv('feMergeNode', { in: 'SourceGraphic' }, m);
  return f;
}
const hType = (txt, t, t0, cps) => esc(String(txt || '').slice(0, Math.max(0, Math.floor((t - t0) * (cps || 22)))));
// the caps title top-left and the source bottom-left every data scene carries
function hFrameText(holder, title, source, t0 = 0.1) {
  const tt = title ? hEl('div', 'position:absolute;left:150px;top:92px;font:600 24px/1.2 PO;letter-spacing:.2em;text-transform:uppercase;color:rgba(244,241,234,.72)', holder, '') : null;
  const sr = source ? hEl('div', 'position:absolute;left:150px;bottom:54px;font:500 19px PO;letter-spacing:.08em;text-transform:uppercase;color:rgba(244,241,234,.42);opacity:0', holder, esc(source)) : null;
  return t => { if (tt) tt.innerHTML = hType(title, t, t0, 30); if (sr) sr.style.opacity = seg(t, t0 + 0.2, t0 + 0.6); };
}
const num = (v, d = 0) => { const x = Number(v); return isFinite(x) ? x : d; };
// big values read as words (86.3 million) and axes as short marks (80M): nine digits changing under the pen are noise
const hNum = (v, dp = 0) => { const a = Math.abs(v);
  if (a >= 1e9) return (v / 1e9).toFixed(a >= 1e11 ? 0 : 1).replace(/\.0$/, '') + ' billion';
  if (a >= 1e6) return (v / 1e6).toFixed(a >= 1e8 ? 0 : 1).replace(/\.0$/, '') + ' million';
  return fmt(v, dp); };
const hAxis = (v, dp = 0) => { const a = Math.abs(v);
  if (a >= 1e9) return +(v / 1e9).toFixed(1) + 'B';
  if (a >= 1e6) return +(v / 1e6).toFixed(1) + 'M';
  return fmt(v, dp); };
const HZ = {};

// ── linechart: the pen draws the series while the camera follows it, then pulls out to the whole line ───────────
// data [[x,y]], from/to (the stretch to draw), ref {y, text}, marks [{x, kicker, text, hot, below}], title, source,
// dp (decimals of the value at the pen), outro (pull out at the end; default true)
HZ.linechart = function (L, holder) {
  hGround(holder);
  const D0 = (L.data || []).filter(p => isFinite(p[0]) && isFinite(p[1]));
  if (D0.length < 2) throw new Error('linechart without data');
  const x0 = D0[0][0], x1 = D0[D0.length - 1][0];
  const from = clamp(num(L.from, x0), x0, x1), to = clamp(num(L.to, x1), x0, x1);
  const ymax = Math.max(...D0.map(p => p[1]), num(L.ref && L.ref.y, 0));
  const step = [1, 2, 2.5, 5, 10].map(m => m * Math.pow(10, Math.floor(Math.log10(Math.max(1e-9, ymax / 4))))).find(s => ymax / s <= 6) || ymax / 5;
  const ytop = Math.ceil(ymax * 1.08 / step) * step;
  const span = Math.max(1, x1 - x0), worldW = Math.max(1700, Math.min(4200, span * 40));
  const B = { x0: 200, x1: 200 + worldW, y0: 960, y1: 150 };
  const fx = x => B.x0 + (x - x0) / span * (B.x1 - B.x0), fy = y => B.y0 + y / ytop * (B.y1 - B.y0);
  const valStep = x => { let v = D0[0][1]; for (const p of D0) { if (p[0] <= x + 1e-6) v = p[1]; else break; } return v; };
  const valAt = x => { if (x <= D0[0][0]) return D0[0][1]; for (let i = 0; i < D0.length - 1; i++) if (x <= D0[i + 1][0]) return lerp(D0[i][1], D0[i + 1][1], (x - D0[i][0]) / Math.max(1e-9, D0[i + 1][0] - D0[i][0])); return D0[D0.length - 1][1]; };
  const outro = L.outro !== false, penEnd = Math.max(1.2, D - (outro ? 1.9 : 0.7));
  const pen = [{ t: 0.35, v: from }, { t: penEnd, v: to, e: 'eio3' }];
  const penX = t => hKey(pen, t);
  const whenAt = x => { if (x <= from) return 0.35; for (let t = 0.35; t <= penEnd; t += 0.02) if (penX(t) >= x) return t; return penEnd; };
  const wm = hEl('div', 'position:absolute;right:50px;bottom:-70px;font:400 420px/1 PF;color:rgba(255,255,255,.04);white-space:nowrap', holder, '');
  const cam = hEl('div', 'position:absolute;left:0;top:0;width:1px;height:1px;transform-origin:0 0', holder);
  const hud = hEl('div', 'position:absolute;inset:0', holder);
  const s = hSvg(cam), defs = hSv('defs', {}, s);
  hGlow(defs, 'lcg', 9);
  const gr = hSv('linearGradient', { id: 'lca', x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
  hSv('stop', { offset: '0', 'stop-color': '#fff', 'stop-opacity': .12 }, gr); hSv('stop', { offset: '1', 'stop-color': '#fff', 'stop-opacity': 0 }, gr);
  const XR = B.x1 + 140, thin = [];
  const grid = [];
  for (let v = step; v <= ytop + 1e-9; v += step) {
    thin.push([hSv('line', { x1: B.x0 - 40, x2: XR, y1: fy(v), y2: fy(v), stroke: 'rgba(255,255,255,.075)' }, s), 'stroke-width', 1.2]);
    grid.push({ v, e: hEl('div', 'position:absolute;width:80px;text-align:right;font:500 21px/28px PO;color:rgba(255,255,255,.36);transform:translate(-100%,-50%)', hud, hAxis(v, step < 1 ? 1 : 0)) });
  }
  thin.push([hSv('line', { x1: B.x0 - 40, x2: XR, y1: fy(0), y2: fy(0), stroke: 'rgba(255,255,255,.3)' }, s), 'stroke-width', 1.5]);
  const tstep = span > 120 ? 20 : span > 50 ? 10 : span > 20 ? 5 : span > 8 ? 2 : 1, ticks = [];
  for (let y = Math.ceil(x0 / tstep) * tstep; y <= x1; y += tstep) {
    thin.push([hSv('line', { x1: fx(y), x2: fx(y), y1: fy(0), y2: fy(0) + 10, stroke: 'rgba(255,255,255,.3)' }, s), 'stroke-width', 1.5]);
    ticks.push({ y, e: hEl('div', 'position:absolute;width:120px;text-align:center;font:500 23px PO;color:rgba(255,255,255,.45);transform:translate(-50%,16px)', hud, String(y)) });
  }
  let refClip = null, refLab = null, refLine = null;
  const ref = L.ref && isFinite(num(L.ref.y, NaN)) ? L.ref : null;
  if (ref) {
    const cp = hSv('clipPath', { id: 'lcr' }, defs);
    refClip = hSv('rect', { x: B.x0 - 40, y: -4000, width: 0, height: 9000 }, cp);
    refLine = hSv('line', { x1: B.x0 - 40, x2: XR, y1: fy(ref.y), y2: fy(ref.y), stroke: 'rgba(255,255,255,.72)', 'clip-path': 'url(#lcr)' }, s);
    refLab = hEl('div', 'position:absolute;font:600 23px PO;letter-spacing:.14em;text-transform:uppercase;color:rgba(255,255,255,.8);white-space:nowrap;transform:translateY(-130%)', hud, '');
  }
  const area = hSv('path', { d: '', fill: 'url(#lca)' }, s);
  const glow = hSv('path', { d: '', fill: 'none', stroke: '#fff', opacity: .45, filter: 'url(#lcg)', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, s);
  const line = hSv('path', { d: '', fill: 'none', stroke: '#fff', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, s);
  thin.push([glow, 'stroke-width', 8], [line, 'stroke-width', 4]);
  const halo = hSv('circle', { fill: '#fff', opacity: .22, filter: 'url(#lcg)' }, s), dot = hSv('circle', { fill: '#fff' }, s);
  thin.push([halo, 'r', 20], [dot, 'r', 8]);
  const marks = (L.marks || []).filter(m => isFinite(num(m.x, NaN))).map((m, i) => {
    // a point in the top third of the chart takes its label below the line, or the label leaves the frame
    const wx = fx(num(m.x)), wy = fy(valAt(num(m.x)));
    const below = m.below != null ? !!m.below : wy < B.y1 + 0.34 * (B.y0 - B.y1), dy = below ? 110 : -150;
    const g = hSv('g', { opacity: 0 }, s);
    const ld = hSv('line', { x1: wx, y1: wy, x2: wx, y2: wy, stroke: 'rgba(255,255,255,.75)' }, g);
    const md = hSv('circle', { cx: wx, cy: wy, fill: m.hot ? HRED : '#fff', stroke: HNAVY }, g);
    thin.push([ld, 'stroke-width', 2], [md, 'r', 9], [md, 'stroke-width', 3]);
    const box = hEl('div', `position:absolute;white-space:nowrap;text-align:center;opacity:0`, hud);
    const k = m.kicker ? hEl('div', `font:600 21px/1.2 PO;letter-spacing:.16em;text-transform:uppercase;color:${m.hot ? '#ff8a93' : 'rgba(255,255,255,.62)'};margin-bottom:8px`, box, '') : null;
    const v = hEl('div', `font:400 ${m.hot ? 76 : 44}px/1.05 PF;color:#fff`, box, '');
    const at = whenAt(num(m.x)) + 0.1, st = at + 0.3 + (m.kicker ? 0.25 : 0);
    const cps = Math.max(26, String(m.text || '').length / Math.max(0.35, D - 0.5 - st));
    return { m, wx, wy, dy, g, ld, box, k, v, at, st, cps };
  });
  const head = hEl('div', 'position:absolute;white-space:nowrap;transform:translate(26px,-100%)', hud);
  const hy = hEl('div', 'font:600 22px/1 PO;letter-spacing:.14em;color:rgba(255,255,255,.55);margin-bottom:8px', head, '');
  const hv = hEl('div', 'font:400 58px/1 PF;color:#fff', head, '');
  const fr = hFrameText(holder, L.title, L.source);
  const S0 = 1.35;
  const followAt = t => { const x = penX(Math.max(0, t - 0.35)); const ox = lerp(0, 330, SM(seg(t, 0.35, 2.0))); return { cx: fx(x) - ox / S0, cy: lerp(fy(valAt(x)), 540, 0.3), s: S0 }; };
  const wide = { cx: (B.x0 - 40 + XR) / 2, cy: 560, s: Math.min(0.95, 1700 / (XR - B.x0 + 120)) };
  const camAt = t => {
    if (!outro || t <= penEnd + 0.1) return followAt(t);
    const f0 = followAt(penEnd + 0.1);
    return hCam([{ t: penEnd + 0.1, cx: f0.cx, cy: f0.cy, s: f0.s }, { t: Math.min(D - 0.3, penEnd + 1.4), cx: wide.cx, cy: wide.cy, s: wide.s }], t, 'eio3');
  };
  const dp = L.dp != null ? num(L.dp, 2) : (ymax < 10 ? 2 : ymax < 100 ? 1 : 0);
  return t => {
    const c = camAt(t);
    hCamXY(cam, c);
    const sx = x => 960 + (x - c.cx) * c.s, sy = y => 540 + (y - c.cy) * c.s;
    thin.forEach(([e, a, px]) => e.setAttribute(a, px / c.s));
    const xp = penX(t), vp = valAt(xp);
    const pts = D0.filter(p => p[0] < xp).map(p => [fx(p[0]), fy(p[1])]);
    pts.push([fx(xp), fy(vp)]);
    const d = 'M' + pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join('L');
    line.setAttribute('d', d); glow.setAttribute('d', d);
    area.setAttribute('d', d + `L${fx(xp).toFixed(1)},${fy(0)}L${fx(D0[0][0])},${fy(0)}Z`);
    [dot, halo].forEach(e => { e.setAttribute('cx', fx(xp)); e.setAttribute('cy', fy(vp)); });
    const hp = outro ? 1 - seg(t, penEnd + 0.1, penEnd + 0.4) : 1;
    dot.setAttribute('opacity', hp); halo.setAttribute('opacity', 0.22 * hp);
    head.style.left = sx(fx(xp)) + 'px'; head.style.top = (sy(fy(vp)) - 24) + 'px'; head.style.opacity = hp;
    hy.textContent = String(Math.floor(xp + 1e-6)); hv.textContent = hNum(valStep(xp), dp);
    grid.forEach(o => { o.e.style.left = sx(B.x0 - 50) + 'px'; o.e.style.top = sy(fy(o.v)) + 'px'; });
    ticks.forEach(o => { o.e.style.left = sx(fx(o.y)) + 'px'; o.e.style.top = sy(fy(0)) + 'px'; });
    wm.textContent = String(Math.floor(xp + 1e-6));
    if (ref) {
      const rp = eio3(seg(t, 0.6, 1.8));
      refClip.setAttribute('width', rp * (XR - B.x0 + 40));
      refLine.setAttribute('stroke-width', 2.5 / c.s); refLine.setAttribute('stroke-dasharray', `${14 / c.s} ${10 / c.s}`);
      refLab.innerHTML = hType(ref.text || '', t, 0.8, 26);
      refLab.style.left = Math.max(sx(B.x0 - 40) + 10, 64) + 'px'; refLab.style.top = sy(fy(ref.y)) + 'px';
    }
    marks.forEach(o => {
      o.g.setAttribute('opacity', seg(t, o.at, o.at + 0.25));
      // the label stays inside the frame, clear of the title and the source line; its leader meets it there
      const bw = o.box.offsetWidth, bh = o.box.offsetHeight;
      // held inside the frame while its point is on screen; a point the camera has left takes its label with it
      const px = sx(o.wx), bl = px >= 0 && px <= W ? clamp(px - bw / 2, 70, W - 70 - bw) : px - bw / 2;
      const bt = clamp(sy(o.wy) + o.dy - (o.dy < 0 ? bh : 0), 140, H - 110 - bh);
      o.box.style.left = bl + 'px'; o.box.style.top = bt + 'px'; o.box.style.transform = 'none';
      const edge = o.dy < 0 ? bt + bh + 8 : bt - 8;
      o.ld.setAttribute('y2', o.wy + (edge - sy(o.wy)) / c.s * eo3(seg(t, o.at, o.at + 0.35)));
      o.box.style.opacity = t >= o.at + 0.3 ? 1 : 0;
      if (o.k) o.k.innerHTML = hType(o.m.kicker, t, o.at + 0.3, 30);
      o.v.innerHTML = hType(o.m.text, t, o.st, o.cps);
    });
    fr(t);
  };
};

// ── pyramid: a real population pyramid (UN WPP) morphing from year to year; men left, women right ─────────────────
// pop {year: [[men x21],[women x21]]} (thousands), years [y0, y1, …], ghost (a year kept as a dashed outline),
// hl "children" | "old" | "both", caption, source
HZ.pyramid = function (L, holder) {
  hGround(holder);
  const P0 = L.pop || {}, ys = Object.keys(P0).map(Number).sort((a, b) => a - b);
  if (!ys.length) throw new Error('pyramid without data');
  const want = (L.years || [ys[0], ys[ys.length - 1]]).map(Number).filter(y => P0[y] || P0[String(y)]);
  const keysY = want.length ? want : [ys[0], ys[ys.length - 1]];
  const get = y => P0[y] || P0[String(y)];
  let vmax = 1; keysY.forEach(y => get(y).forEach(side => side.forEach(v => { vmax = Math.max(vmax, v); })));
  const ghostY = L.ghost != null ? Number(L.ghost) : (keysY.length > 1 ? keysY[0] : null);
  if (ghostY != null && get(ghostY)) get(ghostY).forEach(side => side.forEach(v => { vmax = Math.max(vmax, v); }));
  const k = 700 / vmax, nr = 21, bh = 32, gap = 4, spine = 104, cx = 1000, base = 968;   // clear of the source line
  const cam = hEl('div', 'position:absolute;inset:0;transform-origin:960px 540px', holder);
  const rowY = i => base - (i + 1) * (bh + gap) + gap;
  const AGES = ['0–4', '5–9', '10–14', '15–19', '20–24', '25–29', '30–34', '35–39', '40–44', '45–49', '50–54', '55–59', '60–64', '65–69', '70–74', '75–79', '80–84', '85–89', '90–94', '95–99', '100+'];
  const ghost = [];
  if (ghostY != null && get(ghostY) && keysY.length > 1) {
    const G = get(ghostY);
    for (let i = 0; i < nr; i++) {
      ghost.push(hEl('div', `position:absolute;top:${rowY(i)}px;height:${bh}px;left:${cx - spine / 2 - G[0][i] * k}px;width:${G[0][i] * k}px;border:1.5px dashed rgba(255,255,255,.34);border-right:none;border-radius:3px 0 0 3px;opacity:0`, cam));
      ghost.push(hEl('div', `position:absolute;top:${rowY(i)}px;height:${bh}px;left:${cx + spine / 2}px;width:${G[1][i] * k}px;border:1.5px dashed rgba(255,255,255,.34);border-left:none;border-radius:0 3px 3px 0;opacity:0`, cam));
    }
  }
  const rows = [];
  for (let i = 0; i < nr; i++) {
    const y = rowY(i);
    const m = hEl('div', `position:absolute;top:${y}px;height:${bh}px;left:${cx - spine / 2}px;width:0;background:rgba(236,240,244,.9);border-radius:3px 0 0 3px;overflow:hidden`, cam);
    const f = hEl('div', `position:absolute;top:${y}px;height:${bh}px;left:${cx + spine / 2}px;width:0;background:rgba(236,240,244,.62);border-radius:0 3px 3px 0;overflow:hidden`, cam);
    const mh = hEl('div', 'position:absolute;inset:0;opacity:0', m), fh = hEl('div', 'position:absolute;inset:0;opacity:0', f);
    if (i % 2 === 0) hEl('div', `position:absolute;top:${y}px;height:${bh}px;left:${cx - spine / 2}px;width:${spine}px;text-align:center;font:500 19px/${bh}px PO;color:rgba(255,255,255,.5)`, cam, AGES[i]);
    rows.push({ m, f, mh, fh });
  }
  const topY = rowY(nr - 1) - 64;
  hEl('div', `position:absolute;left:${cx - spine / 2 - 170}px;top:${topY}px;width:160px;text-align:right;font:600 20px PO;letter-spacing:.2em;color:rgba(255,255,255,.5)`, cam, esc(L.men || 'MEN'));
  hEl('div', `position:absolute;left:${cx + spine / 2 + 10}px;top:${topY}px;width:200px;font:600 20px PO;letter-spacing:.2em;color:rgba(255,255,255,.5)`, cam, esc(L.women || 'WOMEN'));
  const yr = hEl('div', 'position:absolute;left:150px;top:150px;font:400 150px/1 PF;color:#fff', holder, '');
  const st1 = hEl('div', 'position:absolute;left:150px;top:325px;font:400 44px/1.1 PF;color:rgba(255,255,255,.9);white-space:nowrap', holder, '');
  const st2 = hEl('div', 'position:absolute;left:150px;top:390px;font:500 26px/1.2 PO;letter-spacing:.06em;color:rgba(255,255,255,.6);white-space:nowrap', holder, '');
  const cap = L.caption ? hEl('div', 'position:absolute;left:1480px;top:300px;width:400px;font:400 40px/1.2 PF;color:#fff', holder, '') : null;
  const fr = hFrameText(holder, L.title, L.source);
  const hlRows = { children: [0, 1, 2], old: [13, 14, 15, 16, 17, 18, 19, 20] };
  const hl = L.hl === 'both' ? [['children', HRED], ['old', HAMB]] : L.hl === 'children' ? [['children', HRED]] : L.hl === 'old' ? [['old', HAMB]] : [];
  const hlAt = Math.max(1.4, D - 1.6);
  const morphEnd = Math.max(1.3, D - 1.7);
  const yk = [{ t: 0, v: keysY[0] }, { t: 0.9, v: keysY[0] }];
  for (let i = 1; i < keysY.length; i++) yk.push({ t: 0.9 + (morphEnd - 0.9) * i / (keysY.length - 1), v: keysY[i], e: 'eio3' });
  return t => {
    const yv = clamp(hKey(yk, t), ys[0], ys[ys.length - 1]);
    const lo = ys.filter(y => y <= yv).pop() ?? ys[0], hi = ys.find(y => y >= yv) ?? lo;
    const fr_ = hi > lo ? (yv - lo) / (hi - lo) : 0, A = get(lo), Bv = get(hi);
    let tot = 0, old = 0;
    rows.forEach((r, i) => {
      const gp = eo3(seg(t, i * 0.02, i * 0.02 + 0.7));
      const mv = lerp(A[0][i], Bv[0][i], fr_), fv = lerp(A[1][i], Bv[1][i], fr_);
      tot += mv + fv; if (i >= 13) old += mv + fv;
      r.m.style.width = (mv * k * gp) + 'px'; r.m.style.left = (cx - spine / 2 - mv * k * gp) + 'px';
      r.f.style.width = (fv * k * gp) + 'px';
      let hc = null, hp = 0;
      hl.forEach(([name, col]) => { if (hlRows[name].includes(i)) { hp = seg(t, hlAt, hlAt + 0.35); hc = col; } });
      if (hc) { r.mh.style.background = hc; r.fh.style.background = hc; }
      r.mh.style.opacity = hp; r.fh.style.opacity = hp * 0.85;
    });
    ghost.forEach(g => { g.style.opacity = seg(t, 1.0, 1.5); });
    const vis = seg(t, 0, 0.4);
    yr.textContent = String(Math.round(yv)); yr.style.opacity = vis;
    st1.textContent = (tot / 1000).toFixed(1) + ' million'; st1.style.opacity = vis;
    st2.textContent = 'AGED 65+: ' + Math.round(old / Math.max(1, tot) * 100) + '%'; st2.style.opacity = vis;
    if (cap) cap.innerHTML = hType(L.caption, t, hlAt + 0.2, 26);
    const c = 1 + 0.035 * seg(t, 0, D);
    cam.style.transform = `scale(${c})`;
    fr(t);
  };
};

// ── gens: every hundred people, their children, grandchildren, great-grandchildren — the camera dives row by row,
// then pulls out to the whole funnel. rate (births per woman) -> counts (horizon.py), labels [4], note
HZ.gens = function (L, holder) {
  hGround(holder);
  const counts = (L.counts || [100, 36, 13, 4.7]).map(Number);
  const labels = L.labels || ['PEOPLE TODAY', 'THEIR CHILDREN', 'GRANDCHILDREN', 'GREAT-GRANDCHILDREN'];
  const cam = hEl('div', 'position:absolute;left:0;top:0;width:1px;height:1px;transform-origin:0 0', holder);
  const s = hSvg(cam);
  const dsz = 26, dg = 18, cx = 1060;
  const per = [25, 18, 13, 6], ysR = [250, 880, 1420, 1900];
  let seed = 7; const rr = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const step = Math.max(0.9, (D - 2.6) / 3), tk = [0.2, 0.2 + step, 0.2 + 2 * step, 0.2 + 3 * step];
  const rows = counts.slice(0, 4).map((n0, ri) => {
    const n = Math.max(1, Math.ceil(n0 - 1e-9)), pr = Math.min(n, per[ri]), lines_ = Math.ceil(n / pr);
    const w = pr * (dsz + dg) - dg, h = lines_ * (dsz + dg) - dg, x0 = cx - w / 2, y0 = ysR[ri];
    const dots = [];
    for (let i = 0; i < n; i++) {
      const c = i % pr, r = Math.floor(i / pr), inRow = (r === lines_ - 1) ? n - r * pr : pr, off = (pr - inRow) * (dsz + dg) / 2;
      const frac = i === n - 1 ? n0 - (n - 1) : 1;
      const e = hEl('div', `position:absolute;left:${x0 + off + c * (dsz + dg)}px;top:${y0 + r * (dsz + dg)}px;width:${dsz}px;height:${dsz}px;border-radius:50%;background:#EEF2F5;box-shadow:0 0 14px rgba(255,255,255,.35);opacity:0`, cam);
      dots.push({ e, frac: Math.max(0.15, frac), d: rr() });
    }
    const big = hEl('div', `position:absolute;left:${x0 - 80}px;top:${y0 + h / 2}px;transform:translate(-100%,-50%);text-align:right;white-space:nowrap;opacity:0`, cam);
    const show = n0 >= 10 ? Math.round(n0) : Math.round(n0);
    hEl('div', `font:400 128px/1 PF;color:${ri === 3 ? '#ff8a93' : '#fff'}`, big, esc(String(show)));
    const bc = hEl('div', 'margin-top:10px;font:500 28px/1.2 PO;letter-spacing:.06em;color:rgba(255,255,255,.66)', big, '');
    return { dots, x0, y0, w, h, big, bc, t0: tk[ri], label: labels[ri] || '' };
  });
  const cons = [];
  rows.forEach((o, i) => {
    if (!i) return;
    const p = rows[i - 1];
    const a = hSv('line', { x1: p.x0, y1: p.y0 + p.h + 18, x2: o.x0, y2: o.y0 - 18, stroke: 'rgba(255,255,255,.28)', 'stroke-width': 2, 'stroke-dasharray': '3 7' }, s);
    const b = hSv('line', { x1: p.x0 + p.w, y1: p.y0 + p.h + 18, x2: o.x0 + o.w, y2: o.y0 - 18, stroke: 'rgba(255,255,255,.28)', 'stroke-width': 2, 'stroke-dasharray': '3 7' }, s);
    cons.push({ a, b, p, o });
  });
  const note = L.note || (L.rate ? `IF THE RATE STAYED AT ${L.rate} CHILDREN PER WOMAN` : '');
  const cap = note ? hEl('div', 'position:absolute;left:0;width:1920px;top:990px;text-align:center;font:600 24px PO;letter-spacing:.16em;color:rgba(255,255,255,.7)', holder, '') : null;
  const r = rows.length, last = rows[r - 1];
  const ck = [{ t: 0, cx: 960, cy: 330, s: 1.12 }];
  for (let i = 1; i < r; i++) {
    ck.push({ t: rows[i].t0 - 0.5, cx: 960, cy: ysR[i - 1] + 80, s: 1.2 + 0.04 * i });
    ck.push({ t: rows[i].t0 + 0.12, cx: 960, cy: ysR[i] + 60, s: 1.24 + 0.04 * i });
  }
  const outT = Math.min(D - 1.5, last.t0 + 0.8);
  ck.push({ t: outT, cx: 960, cy: ysR[r - 1] + 60, s: 1.36 });
  ck.push({ t: Math.min(D - 0.35, outT + 1.1), cx: 880, cy: 1130, s: 0.45 });
  const fr = hFrameText(holder, L.title, L.source);
  return t => {
    hCamXY(cam, hCam(ck, t, 'eio3'));
    rows.forEach(o => {
      o.dots.forEach(d => { const p = seg(t, o.t0 + d.d * 0.6, o.t0 + d.d * 0.6 + 0.25); d.e.style.opacity = p * d.frac; d.e.style.transform = `scale(${0.4 + 0.6 * eback(p)})`; });
      o.big.style.opacity = seg(t, o.t0 + 0.1, o.t0 + 0.4);
      o.bc.innerHTML = hType(o.label, t, o.t0 + 0.35, 26);
    });
    cons.forEach(c => {
      const t0 = c.o.t0 - 0.55, p = eio3(seg(t, t0, t0 + 0.55));
      c.a.setAttribute('x2', lerp(c.p.x0, c.o.x0, p)); c.a.setAttribute('y2', lerp(c.p.y0 + c.p.h + 18, c.o.y0 - 18, p)); c.a.setAttribute('opacity', p > 0 ? 1 : 0);
      c.b.setAttribute('x2', lerp(c.p.x0 + c.p.w, c.o.x0 + c.o.w, p)); c.b.setAttribute('y2', lerp(c.p.y0 + c.p.h + 18, c.o.y0 - 18, p)); c.b.setAttribute('opacity', p > 0 ? 1 : 0);
    });
    if (cap) cap.innerHTML = hType(note, t, outT + 0.5, 30);
    fr(t);
  };
};

// ── numroll: a figure rolling like an odometer from one value to the next (0.78 -> 0.72, 2,700,000 -> 686,000) ────
// from, to, kicker, kicker_to, sub, source, hot (red when it lands). The two figures are lined up on their decimal
// point; a digit only one of them has rolls out (or in) while its column closes (or opens), so the figure stays
// centred. Without a real "from" (none, or a bare 0) the one figure counts up at once and only its own label shows —
// a 0 that nobody said is never on screen under a label.
HZ.numroll = function (L, holder) {
  hGround(holder);
  const cam = hEl('div', 'position:absolute;inset:0;transform-origin:960px 540px', holder);
  const to = String(L.to ?? L.value ?? L.from ?? '0').trim();
  const fromRaw = L.from == null ? '' : String(L.from).trim();
  const count = !fromRaw || !/[1-9]/.test(fromRaw);                  // no earlier figure: count up
  const split = s => { const i = s.indexOf('.'); return i < 0 ? [s, null] : [s.slice(0, i), s.slice(i + 1)]; };
  const zeroLike = s => s.replace(/[1-9]/g, '0');
  let [ai, af] = split(count ? zeroLike(to) : fromRaw), [bi, bf] = split(to);
  const ni = Math.max(ai.length, bi.length);
  ai = ai.padStart(ni, ' '); bi = bi.padStart(ni, ' ');
  let a = ai, b = bi;
  if (af != null || bf != null) {
    const nf = Math.max((af || '').length, (bf || '').length);
    a += (af != null ? '.' : ' ') + (af || '').padEnd(nf, ' ');
    b += (bf != null ? '.' : ' ') + (bf || '').padEnd(nf, ' ');
  }
  const size = 300, y = 540, isD = ch => /[0-9]/.test(ch);
  const wOf = ch => ch === ' ' ? 0 : isD(ch) ? 0.58 : /[.,]/.test(ch) ? 0.27 : 0.55;
  const kick = hEl('div', `position:absolute;left:0;width:1920px;top:${y - size / 2 - 70}px;text-align:center;font:600 26px PO;letter-spacing:.24em;text-transform:uppercase;color:rgba(255,255,255,.62)`, cam, '');
  const row = hEl('div', `position:absolute;left:0;width:1920px;top:${y - size / 2}px;height:${size}px;display:flex;justify-content:center;font:400 ${size}px/1 PF;color:#fff;text-shadow:0 0 40px rgba(255,255,255,.18)`, cam);
  const cols = [];
  for (let i = 0; i < a.length; i++) {
    const ca = a[i], cb = b[i], w0 = wOf(ca), w1 = wOf(cb);
    const win = hEl('div', `position:relative;flex:none;height:${size * 1.12}px;margin-top:${-size * 0.06}px;overflow:hidden;width:${w0}em`, row);
    if (isD(ca) && isD(cb)) {
      const strip = hEl('div', 'position:absolute;left:0;top:0;width:100%;text-align:center', win);
      for (let d = 0; d < 20; d++) hEl('div', `height:${size * 1.6}px;line-height:${size * 1.6}px`, strip, String(d % 10));
      cols.push({ win, strip, d0: +ca, d1: +cb, w0, w1, ca, cb });
    } else {
      const inner = hEl('div', `position:absolute;left:0;top:${size * 0.06}px;width:100%;height:${size}px;line-height:${size}px;text-align:center;white-space:pre`, win, esc(ca === ' ' ? cb : ca));
      cols.push({ win, inner, w0, w1, ca, cb });
    }
  }
  const sub = L.sub ? hEl('div', `position:absolute;left:0;width:1920px;top:${y + size / 2 + 40}px;text-align:center;font:400 44px/1.25 PF;color:rgba(255,255,255,.85)`, cam, '') : null;
  const src = L.source ? hEl('div', 'position:absolute;left:0;width:1920px;bottom:54px;text-align:center;font:500 19px PO;letter-spacing:.08em;text-transform:uppercase;color:rgba(255,255,255,.4)', holder, esc(L.source)) : null;
  const r0 = count ? 0.05 : 0.42 * D, r1 = r0 + (count ? Math.min(1.5, 0.35 * D) : Math.min(1.2, 0.3 * D));
  const Y = k => -k * size * 1.6 - size * 0.24;                         // strip offset showing cell k
  return t => {
    // a count-up spins at once and settles (ease-out); a change from one figure to another eases both ways
    const p = count ? eo3(seg(t, r0, r1)) : eio3(seg(t, r0, r1));
    cols.forEach(c => {
      c.win.style.width = lerp(c.w0, c.w1, p) + 'em';
      if (c.strip) {
        // a change rolls down to the new digit; a count-up rolls UP from 0, so the figure grows as it lands
        const k = count ? c.d0 + ((c.d1 - c.d0 + 10) % 10) * p
          : (c.d0 + 10) - (c.d1 === c.d0 ? 0 : ((c.d0 - c.d1 + 10) % 10) || 10) * p;
        c.strip.style.transform = `translateY(${Y(k)}px)`;
      } else if (c.ca !== c.cb) {
        // a character only one figure has: it lifts out (or drops in) and fades while its column closes (or opens);
        // two different characters swap at the middle of the roll
        const out = p < 0.5, ch = out ? c.ca : c.cb;
        c.inner.textContent = ch === ' ' ? '' : ch;
        const q = out ? seg(p, 0, 0.5) : 1 - seg(p, 0.5, 1);
        c.inner.style.opacity = 1 - q;
        c.inner.style.transform = `translateY(${(out ? -1 : 1) * q * size * 0.35}px)`;
      }
    });
    row.style.color = (L.hot && t >= r1) ? '#ff6b76' : '#fff';
    row.style.opacity = count ? seg(p, 0.1, 0.4) : seg(t, 0.05, 0.4);   // the count-up's zeros are never read
    const lab = count ? (L.kicker_to || L.kicker || '') : '';
    kick.innerHTML = count ? hType(lab, t, 0.05, 34)
      : (t < r1 || !L.kicker_to ? hType(L.kicker || '', t, 0.05, 30) : hType(L.kicker_to, t, r1, 40));
    if (sub) sub.innerHTML = hType(L.sub, t, r1 + 0.2, 26);
    if (src) src.style.opacity = seg(t, 0.3, 0.7);
    cam.style.transform = `scale(${1 + 0.05 * seg(t, 0, D)})`;
  };
};

// ── yearbars: one bar per year, the camera travelling along them; ranges light up with a bracket label ────────────
// data [[year, value]], hl [{from, to, label, sub, hot}], title, source
HZ.yearbars = function (L, holder) {
  hGround(holder);
  const D0 = (L.data || []).filter(p => isFinite(p[0]) && isFinite(p[1]));
  if (D0.length < 3) throw new Error('yearbars without data');
  const vmax = Math.max(...D0.map(p => p[1])) * 1.08, n = D0.length;
  const bw = n > 90 ? 14 : n > 50 ? 22 : 30, gap = Math.round(bw * 0.3), base = 900, hmax = 620, x0 = 200;
  const xOf = i => x0 + i * (bw + gap), worldW = xOf(n - 1) + bw - x0;
  const cam = hEl('div', 'position:absolute;left:0;top:0;width:1px;height:1px;transform-origin:0 0', holder);
  const hud = hEl('div', 'position:absolute;inset:0', holder);
  const bars = D0.map(([y, v], i) => ({ i, v, b: hEl('div', `position:absolute;left:${xOf(i)}px;width:${bw}px;top:${base}px;height:0;border-radius:2px 2px 0 0;background:rgba(236,240,244,.82)`, cam) }));
  hEl('div', `position:absolute;left:${x0 - 30}px;top:${base}px;width:${worldW + 60}px;height:1.5px;background:rgba(255,255,255,.35)`, cam);
  const span = D0[n - 1][0] - D0[0][0], ts = span > 80 ? 20 : span > 30 ? 10 : 5;
  D0.forEach(([y], i) => { if (y % ts === 0) hEl('div', `position:absolute;left:${xOf(i) + bw / 2 - 60}px;top:${base + 16}px;width:120px;text-align:center;font:500 24px PO;color:rgba(255,255,255,.5)`, cam, String(y)); });
  const hlist = (L.hl || []).map((h, j, arr) => {
    const i0 = D0.findIndex(d => d[0] >= num(h.from)), i1raw = D0.map(d => d[0]).lastIndexOf(D0.filter(d => d[0] <= num(h.to ?? h.from)).pop()?.[0]);
    if (i0 < 0 || i1raw < i0) return null;
    const i1 = i1raw, top = base - hmax * Math.max(...D0.slice(i0, i1 + 1).map(d => d[1])) / vmax - 34;
    const col = h.hot ? HRED : HAMB;
    const br = hEl('div', `position:absolute;left:${xOf(i0)}px;top:${top}px;width:${xOf(i1) + bw - xOf(i0)}px;height:14px;border:2px solid ${col};border-bottom:none;opacity:0`, cam);
    const lab = hEl('div', 'position:absolute;white-space:nowrap;text-align:center;transform:translate(-50%,-100%);opacity:0', hud);
    const l1 = hEl('div', `font:600 21px/1.2 PO;letter-spacing:.14em;text-transform:uppercase;color:${col};margin-bottom:6px`, lab, '');
    const l2 = hEl('div', 'font:400 50px/1.05 PF;color:#fff', lab, '');
    return { h, i0, i1, top, br, lab, l1, l2, col };
  }).filter(Boolean);
  const k = hlist.length, fitS = Math.min(1.0, 1700 / (worldW + 160));
  const ov = { cx: x0 + worldW / 2, cy: 600, s: fitS };
  const cks = [{ t: 0, ...ov }, { t: 0.9, ...ov }];
  hlist.forEach((q, j) => {
    q.at = 1.1 + (Math.max(1.4, D - 1.6) - 1.1) * (k > 1 ? j / (k - 1) : 0.3);
    q.until = j < k - 1 ? null : null;
    const mx = (xOf(q.i0) + xOf(q.i1) + bw) / 2;
    const s = Math.max(fitS, Math.min(1.25, 1400 / Math.max(400, worldW * 0.45)));
    cks.push({ t: Math.max(1.0, q.at - 0.6), cx: clamp(mx, x0 + 960 / s - 100, x0 + worldW - 960 / s + 100), cy: 640, s });
    cks.push({ t: q.at + 0.8, cx: clamp(mx, x0 + 960 / s - 100, x0 + worldW - 960 / s + 100), cy: 640, s: s * 1.02 });
  });
  const fr = hFrameText(holder, L.title, L.source);
  cks.sort((a, b) => a.t - b.t);
  return t => {
    const c = hCam(cks, t, 'eio3');
    hCamXY(cam, c);
    bars.forEach(o => {
      const p = eo3(seg(t, o.i / n * 0.8, o.i / n * 0.8 + 0.5));
      const hh = hmax * o.v / vmax * p;
      o.b.style.height = hh + 'px'; o.b.style.top = (base - hh) + 'px';
      let col = 'rgba(236,240,244,.82)', glow = 'none';
      hlist.forEach(q => { if (o.i >= q.i0 && o.i <= q.i1 && t >= q.at + 0.15) { col = q.col; glow = `0 0 18px ${q.col}88`; } });
      o.b.style.background = col; o.b.style.boxShadow = glow;
    });
    hlist.forEach(q => {
      const a = seg(t, q.at, q.at + 0.3);
      q.br.style.opacity = a;
      const mx = (xOf(q.i0) + xOf(q.i1) + bw) / 2;
      q.lab.style.left = (960 + (mx - c.cx) * c.s) + 'px'; q.lab.style.top = (540 + (q.top - 16 - c.cy) * c.s) + 'px';
      q.lab.style.opacity = a;
      q.l1.innerHTML = hType(q.h.label, t, q.at + 0.1, 30);
      q.l2.innerHTML = hType(q.h.sub, t, q.at + 0.3, 26);
    });
    fr(t);
  };
};

// ── hbars: countries or things side by side — glowing horizontal bars, the subject in red, a dashed reference ─────
// rows [{label, value, hot, dp}], ref {value, text}, title, source, unit ("int" formats with thousands)
HZ.hbars = function (L, holder) {
  hGround(holder);
  const rows0 = (L.rows || []).filter(r => isFinite(num(r.value, NaN))).slice(0, 8);
  if (!rows0.length) throw new Error('hbars without rows');
  const max = num(L.max, 0) || Math.max(...rows0.map(r => num(r.value)), num(L.ref && L.ref.value, 0)) * 1.12;
  const cam = hEl('div', 'position:absolute;inset:0;transform-origin:960px 540px', holder);
  const rh = rows0.length > 5 ? 84 : 110, x0 = 640, w = 1000, y0 = 540 - rows0.length * rh / 2 + 20;
  let order = rows0.map((r, i) => i).filter(i => !rows0[i].hot).concat(rows0.map((r, i) => i).filter(i => rows0[i].hot));
  const rows = rows0.map((r, i) => {
    const y = y0 + i * rh, hot = !!r.hot;
    const lab = hEl('div', `position:absolute;left:${x0 - 40}px;top:${y}px;height:${rh - 22}px;transform:translateX(-100%);font:400 ${hot ? 40 : 36}px/${rh - 22}px PF;color:${hot ? '#fff' : 'rgba(255,255,255,.82)'};white-space:nowrap;opacity:0`, cam, esc(r.label));
    const bar = hEl('div', `position:absolute;left:${x0}px;top:${y + 6}px;height:${rh - 34}px;width:0;border-radius:2px;` +
      (hot ? `background:${HRED};box-shadow:0 0 26px rgba(224,67,76,.55)` : 'background:linear-gradient(90deg,#dfe5ea,#fff);box-shadow:0 0 22px rgba(255,255,255,.28)'), cam);
    const val = hEl('div', `position:absolute;top:${y}px;height:${rh - 22}px;font:600 ${hot ? 34 : 30}px/${rh - 22}px PO;color:${hot ? '#ff8a93' : 'rgba(255,255,255,.75)'};opacity:0`, cam, '');
    return { r, lab, bar, val, t0: 0.3 + order.indexOf(i) * 0.22 + (hot ? 0.35 : 0) };
  });
  let ref = null;
  if (L.ref && isFinite(num(L.ref.value, NaN))) {
    const rx = x0 + w * num(L.ref.value) / max;
    ref = { line: hEl('div', `position:absolute;left:${rx}px;top:${y0 - 30}px;width:0;height:0;border-left:2px dashed rgba(255,255,255,.6)`, cam),
            lab: hEl('div', `position:absolute;left:${rx + 14}px;top:${y0 - 44}px;font:600 20px PO;letter-spacing:.14em;text-transform:uppercase;color:rgba(255,255,255,.75);white-space:nowrap`, cam, ''),
            t0: Math.max(1.2, 0.55 * D) };
  }
  const fr = hFrameText(holder, L.title, L.source);
  return t => {
    rows.forEach(o => {
      const p = eo5(seg(t, o.t0, o.t0 + 0.9)), v = num(o.r.value);
      o.lab.style.opacity = seg(t, o.t0 - 0.1, o.t0 + 0.2);
      o.bar.style.width = (w * v / max * p) + 'px';
      o.val.style.left = (x0 + w * v / max * p + 18) + 'px'; o.val.style.opacity = seg(t, o.t0 + 0.2, o.t0 + 0.5);
      o.val.textContent = Math.abs(v) >= 1e6 ? hNum(v * p, 0) : L.unit === 'int' ? fmt(Math.round(v * p))
        : fmt(v * p, o.r.dp != null ? num(o.r.dp) : (v < 10 ? 2 : v < 100 ? 1 : 0));
    });
    if (ref) {
      const p = eio3(seg(t, ref.t0, ref.t0 + 0.6));
      ref.line.style.height = (p * (rows.length * rh + 40)) + 'px';
      ref.lab.innerHTML = hType(L.ref.text || '', t, ref.t0 + 0.3, 28);
    }
    cam.style.transform = `scale(${1 + 0.04 * seg(t, 0, D)})`;
    fr(t);
  };
};

// ── ticker: a big figure typed digit by digit (a national budget with all its zeros), a kicker, a sub-line ─────────
// text, kicker, sub, source
HZ.ticker = function (L, holder) {
  hGround(holder);
  const cam = hEl('div', 'position:absolute;inset:0;transform-origin:960px 540px', holder);
  const txt = String(L.text || L.value || ''), size = txt.length > 16 ? 132 : txt.length > 10 ? 160 : 190;
  const kick = L.kicker ? hEl('div', 'position:absolute;left:0;width:1920px;top:310px;text-align:center;font:600 24px PO;letter-spacing:.22em;text-transform:uppercase;color:rgba(255,255,255,.6)', cam, '') : null;
  const big = hEl('div', `position:absolute;left:0;width:1920px;top:390px;text-align:center;font:400 ${size}px/1 PF;color:#fff;white-space:nowrap;text-shadow:0 0 30px rgba(255,255,255,.18)`, cam, '');
  const sub = L.sub ? hEl('div', `position:absolute;left:0;width:1920px;top:${390 + size + 44}px;text-align:center;font:400 40px/1.3 PF;color:rgba(255,255,255,.78)`, cam, '') : null;
  const src = L.source ? hEl('div', 'position:absolute;left:0;width:1920px;bottom:54px;text-align:center;font:500 19px PO;letter-spacing:.08em;text-transform:uppercase;color:rgba(255,255,255,.4)', holder, esc(L.source)) : null;
  const t0 = 0.3, end = Math.max(0.9, 0.45 * D), cps = txt.length / Math.max(0.5, end - t0);
  return t => {
    if (kick) kick.innerHTML = hType(L.kicker, t, 0.05, 30);
    const n = Math.min(txt.length, Math.floor(Math.max(0, t - t0) * cps));
    const s = txt.slice(0, n), tc = t - (t0 + (n - 1) / cps);
    big.innerHTML = s ? esc(s.slice(0, -1)) + `<span style="display:inline-block;transform:translateY(${-10 * (1 - eo3(seg(tc, 0, 0.14)))}px);opacity:${seg(tc, 0, 0.08)}">${esc(s.slice(-1))}</span>` : '';
    if (sub) sub.innerHTML = hType(L.sub, t, end + 0.25, 30);
    if (src) src.style.opacity = seg(t, end, end + 0.4);
    cam.style.transform = `scale(${1 + 0.05 * seg(t, 0, D)})`;
  };
};

// ── strike: the things a generation gives up, struck through one by one ─────────────────────────────────────────
// kicker, title (a second line under it), items [text]
HZ.strike = function (L, holder) {
  hGround(holder);
  const cam = hEl('div', 'position:absolute;inset:0;transform-origin:960px 540px', holder);
  const items = (L.items || []).map(String).filter(Boolean).slice(0, 4);
  if (!items.length) throw new Error('strike without items');
  const kick = L.kicker ? hEl('div', 'position:absolute;left:0;width:1920px;top:250px;text-align:center;font:600 26px PO;letter-spacing:.24em;text-transform:uppercase;color:rgba(255,255,255,.62)', cam, '') : null;
  const ttl = L.title ? hEl('div', 'position:absolute;left:0;width:1920px;top:300px;text-align:center;font:400 italic 52px/1.2 PF;color:rgba(255,255,255,.88);opacity:0', cam, esc(L.title)) : null;
  const row = hEl('div', `position:absolute;left:0;width:1920px;top:${L.title ? 520 : 480}px;display:flex;justify-content:center;gap:90px`, cam);
  const size = items.join('').length > 28 ? 86 : 110;
  const it = items.map((x, i) => {
    const w = hEl('div', 'position:relative;opacity:0', row);
    const tx = hEl('div', `font:400 ${size}px/1.1 PF;color:#fff;white-space:nowrap`, w, esc(x));
    const ln = hEl('div', `position:absolute;left:-12px;right:-12px;top:54%;height:9px;background:${HRED};transform-origin:0 50%;transform:scaleX(0);box-shadow:0 0 18px rgba(224,67,76,.55)`, w);
    return { w, tx, ln, t: 0.35 + i * 0.12, st: 0.4 * D + i * (0.45 * D / items.length) };
  });
  return t => {
    if (kick) kick.innerHTML = hType(L.kicker, t, 0.1, 30);
    if (ttl) ttl.style.opacity = seg(t, 0.3, 0.8);
    it.forEach(o => {
      const a = seg(t, o.t, o.t + 0.3);
      o.w.style.opacity = a; o.w.style.transform = `translateY(${(1 - eo3(a)) * 26}px)`;
      o.ln.style.transform = `scaleX(${eo3(seg(t, o.st, o.st + 0.32))})`;
      o.tx.style.opacity = 1 - 0.55 * seg(t, o.st + 0.2, o.st + 0.6);
    });
    cam.style.transform = `scale(${1 + 0.05 * seg(t, 0, D)})`;
  };
};

// ── quote: near-black navy, a B&W portrait fading in from the right, the quote pre-visible and typed through ───────
// text, who, role, photo (horizon.py fetches it from subject/query), mark (a phrase set in red)
HZ.quote = function (L, holder) {
  holder.style.background = HNAVY;
  const cam = hEl('div', 'position:absolute;inset:0;transform-origin:1300px 500px', holder);
  if (L.photo) {
    const im = hEl('img', 'position:absolute;right:0;top:0;height:1080px;width:1020px;object-fit:cover;object-position:50% 28%;' +
      'filter:grayscale(1) contrast(1.2) brightness(.9);-webkit-mask-image:linear-gradient(90deg,transparent 0,#000 30%);mask-image:linear-gradient(90deg,transparent 0,#000 30%)', cam);
    im.src = L.photo;
  }
  hEl('div', `position:absolute;inset:0;background-image:url(${hGrain(256, 30)});opacity:.35;mix-blend-mode:overlay;pointer-events:none`, holder);
  hEl('div', 'position:absolute;inset:0;background:radial-gradient(ellipse 80% 75% at 40% 50%, rgba(0,0,0,0) 50%, rgba(0,0,0,.6) 100%)', holder);
  const full = '“' + String(L.text || '').replace(/^["“]|["”]$/g, '') + '”';
  const size = full.length > 150 ? 38 : full.length > 90 ? 44 : 52;
  const tx = L.photo ? 150 : 360, tw = L.photo ? 900 : 1200;
  const box = hEl('div', `position:absolute;left:${tx}px;top:50%;width:${tw}px;transform:translateY(-60%);text-align:${L.photo ? 'left' : 'center'};font:400 ${size}px/1.32 PF;color:#fff`, cam);
  const lit = hEl('span', 'color:#fff;text-shadow:0 0 10px rgba(255,255,255,.3)', box), rest = hEl('span', 'color:rgba(255,255,255,.16)', box);
  const who = L.who ? hEl('div', `position:absolute;left:${tx}px;width:${tw}px;top:calc(50% + ${Math.round(size * 1.32 * Math.ceil(full.length / (tw / (size * 0.48))) * 0.45) + 40}px);text-align:${L.photo ? 'left' : 'center'};opacity:0`, cam) : null;
  if (who) {
    hEl('div', 'font:600 22px PO;letter-spacing:.16em;text-transform:uppercase;color:rgba(255,255,255,.75)', who, esc(L.who));
    if (L.role) hEl('div', 'margin-top:6px;font:500 19px PO;letter-spacing:.1em;text-transform:uppercase;color:rgba(255,255,255,.45)', who, esc(L.role));
  }
  const t0 = 0.35, t1 = Math.max(t0 + 0.8, D - 1.0), cps = full.length / (t1 - t0);
  const mk = L.mark ? full.toLowerCase().indexOf(String(L.mark).toLowerCase()) : -1;
  return t => {
    const n = Math.min(full.length, Math.floor(Math.max(0, t - t0) * cps));
    if (mk >= 0) {
      const a = full.slice(0, n), m0 = mk, m1 = mk + String(L.mark).length;
      const part = (s, i0, i1) => s.slice(i0, i1);
      lit.innerHTML = esc(part(a, 0, m0)) + `<span style="color:#ff6b76">${esc(part(a, m0, m1))}</span>` + esc(part(a, m1, a.length));
    } else lit.textContent = full.slice(0, n);
    rest.textContent = full.slice(n);
    if (who) who.style.opacity = seg(t, t1 - 0.2, t1 + 0.3);
    cam.style.transform = `scale(${1 + 0.05 * seg(t, 0, D)})`;
  };
};

// ── titlecard: the film's title or a chapter — black, grain, the title opening its letter-spacing, a hairline ─────
// title, sub, kicker
HZ.titlecard = function (L, holder) {
  holder.style.background = '#030405';
  hEl('div', `position:absolute;inset:0;background-image:url(${hGrain(256, 40)});opacity:.28;mix-blend-mode:overlay`, holder);
  const box = hEl('div', 'position:absolute;left:0;width:1920px;top:0;height:1080px;display:flex;flex-direction:column;align-items:center;justify-content:center', holder);
  const kick = L.kicker ? hEl('div', 'margin-bottom:30px;font:600 22px PO;letter-spacing:.32em;text-transform:uppercase;color:rgba(244,241,234,.5);opacity:0', box, esc(L.kicker)) : null;
  const title = String(L.title || '').toUpperCase(), size = title.length > 26 ? 76 : title.length > 18 ? 92 : 104;
  const tt = hEl('div', `font:400 ${size}px/1.05 PF;color:${HINK};white-space:nowrap;opacity:0`, box, esc(title));
  const rule = hEl('div', 'margin:34px 0 28px;height:1px;width:0;background:rgba(244,241,234,.55)', box);
  const sub = L.sub ? hEl('div', 'font:400 italic 34px/1.2 PF;color:rgba(244,241,234,.66);opacity:0', box, esc(L.sub)) : null;
  return t => {
    const q = 1 - seg(t, D - 0.5, D - 0.05), p = seg(t, 0.25, 1.45);
    tt.style.opacity = EO2(p) * q;
    tt.style.letterSpacing = lerp(0.04, 0.14, eo3(seg(t, 0.25, Math.max(1.5, D - 0.3)))) + 'em';
    tt.style.filter = `blur(${(1 - eo3(p)) * 6}px)`;
    rule.style.width = (eio3(seg(t, 0.75, 1.85)) * 300) + 'px'; rule.style.opacity = q;
    if (kick) kick.style.opacity = seg(t, 0.1, 0.7) * q;
    if (sub) sub.style.opacity = seg(t, 1.2, 2.0) * q;
  };
};

// ── docshot: the real document (a poster, a letter, a page) lying on the ground, the camera pushing in, a note with
// a hairline to the spot it translates. photo (+ iw, ih from horizon.py), note {text, sub, x, y (0-1 on the photo)}, source
HZ.docshot = function (L, holder) {
  hGround(holder);
  if (!L.photo) throw new Error('docshot without its document');
  const cam = hEl('div', 'position:absolute;left:0;top:0;width:1px;height:1px;transform-origin:0 0', holder);
  const iw = num(L.iw, 800), ih = num(L.ih, 1000), tall = ih > iw;
  const W0 = tall ? Math.min(760, 860 * iw / ih) : Math.min(1100, 900), H0 = W0 * ih / iw;
  const cx = L.note ? 1140 : 960, cy = 540;
  const card = hEl('div', `position:absolute;left:${cx - W0 / 2}px;top:${cy - H0 / 2}px;width:${W0}px;height:${H0}px;transform:rotate(-1.3deg);box-shadow:0 30px 80px rgba(0,0,0,.6),0 6px 18px rgba(0,0,0,.45)`, cam);
  const im = hEl('img', 'display:block;width:100%;height:100%;filter:contrast(1.04) saturate(.92)', card); im.src = L.photo;
  hEl('div', `position:absolute;inset:0;background-image:url(${hGrain(256, 30)});opacity:.22;mix-blend-mode:overlay`, card);
  let note = null;
  if (L.note && (L.note.text || typeof L.note === 'string')) {
    const N = typeof L.note === 'string' ? { text: L.note } : L.note;
    const s = hSvg(holder);
    const ln = hSv('polyline', { points: '', fill: 'none', stroke: '#fff', 'stroke-width': 2, opacity: 0 }, s);
    const dot = hSv('circle', { r: 6, fill: '#fff', opacity: 0 }, s);
    const box = hEl('div', 'position:absolute;white-space:nowrap;opacity:0;text-align:right;transform:translate(-100%,-50%)', holder);
    const tx = hEl('div', `font:400 ${String(N.text).length > 34 ? 38 : 48}px/1.1 PF;color:#fff;text-shadow:0 2px 16px rgba(0,0,0,.6)`, box, '');
    const sb = hEl('div', 'margin-top:10px;font:600 20px/1.2 PO;letter-spacing:.16em;text-transform:uppercase;color:rgba(255,255,255,.66)', box, '');
    note = { N, ln, dot, box, tx, sb };
  }
  const fr = hFrameText(holder, '', L.source);
  const ck = [{ t: 0, cx, cy, s: 0.94 }, { t: D, cx: cx - 60, cy: cy + 40, s: 1.14 }];
  return t => {
    const c = hCam(ck, t, 'linear');
    hCamXY(cam, c);
    card.style.opacity = seg(t, 0, 0.2);
    if (note) {
      const N = note.N, t0 = Math.min(1.0, 0.25 * D);
      const px = num(N.x, 0.25), py = num(N.y, 0.5);
      const dx = cx - W0 / 2 + px * W0, dy = cy - H0 / 2 + py * H0;
      const sx = 960 + (dx - c.cx) * c.s, sy = 540 + (dy - c.cy) * c.s;
      const lx = Math.min(700, sx - 160), ly = Math.max(220, Math.min(860, sy - 40));
      const p = eo3(seg(t, t0, t0 + 0.35));
      note.dot.setAttribute('cx', sx); note.dot.setAttribute('cy', sy); note.dot.setAttribute('opacity', seg(t, t0, t0 + 0.12));
      note.ln.setAttribute('points', `${sx},${sy} ${lerp(sx, lx, p)},${lerp(sy, ly, p)}`); note.ln.setAttribute('opacity', p > 0 ? 1 : 0);
      note.box.style.left = (lx - 18) + 'px'; note.box.style.top = ly + 'px';
      note.box.style.opacity = p >= 1 ? 1 : 0;
      note.tx.innerHTML = hType(N.text, t, t0 + 0.35, 42);
      note.sb.innerHTML = hType(N.sub || '', t, t0 + 0.8, 34);
    }
    fr(t);
  };
};

// ── readline: the line being said, whole and dim, each word lighting up as it is read; the key words boxed at the
// end and the camera punching in. text, key (a phrase), hot (red box instead of yellow)
HZ.readline = function (L, holder) {
  hGround(holder);
  const cam = hEl('div', 'position:absolute;inset:0;transform-origin:960px 540px', holder);
  const words = String(L.text || '').split(/\s+/).filter(Boolean);
  if (!words.length) throw new Error('readline without text');
  const size = words.length > 16 ? 58 : words.length > 9 ? 66 : 78;
  const box = hEl('div', `position:absolute;left:210px;width:1500px;top:50%;transform:translateY(-50%);text-align:center;font:400 ${size}px/1.3 PF;color:#fff`, cam);
  const spans = words.map((w, i) => hEl('span', 'position:relative;display:inline-block;margin:0 .13em;color:rgba(255,255,255,.18);transition:none', box, esc(w)));
  let k0 = -1, k1 = -1;
  if (L.key) {
    const kw = String(L.key).toLowerCase().split(/\s+/).map(w => w.replace(/[^\p{L}\p{N}%$€£.,-]/gu, ''));
    const norm = w => w.toLowerCase().replace(/[^\p{L}\p{N}%$€£.,-]/gu, '');
    for (let i = 0; i + kw.length <= words.length; i++) if (kw.every((w, j) => norm(words[i + j]).replace(/[.,]$/, '') === w.replace(/[.,]$/, ''))) { k0 = i; k1 = i + kw.length - 1; break; }
  }
  const col = L.hot ? HRED : '#F2D14A';
  const hl = k0 >= 0 ? hEl('div', `position:absolute;background:${col};transform-origin:0 50%;transform:scaleX(0);z-index:-1`, box) : null;
  const t0 = 0.3, t1 = Math.max(1.2, D - 1.6), per = (t1 - t0) / words.length;
  let placed = false;
  return t => {
    spans.forEach((s, i) => {
      const a = seg(t, t0 + i * per, t0 + i * per + 0.15);
      s.style.color = `rgba(255,255,255,${0.18 + 0.82 * a})`;
      if (k0 >= 0 && i >= k0 && i <= k1 && t >= t1) s.style.color = L.hot ? '#fff' : '#111';
    });
    if (hl) {
      if (!placed) {
        const a = spans[k0], b = spans[k1];
        hl.style.left = (a.offsetLeft - 10) + 'px'; hl.style.top = (a.offsetTop + 4) + 'px';
        hl.style.width = (b.offsetLeft + b.offsetWidth - a.offsetLeft + 20) + 'px'; hl.style.height = (a.offsetHeight - 4) + 'px';
        placed = true;
      }
      hl.style.transform = `scaleX(${eo3(seg(t, t1, t1 + 0.4))})`;
    }
    const pz = k0 >= 0 ? eio3(seg(t, t1 + 0.2, t1 + 1.1)) : 0;
    cam.style.transform = `scale(${1 + 0.03 * seg(t, 0, D) + 0.35 * pz})`;
  };
};

// ── tab: a chapter tab — a navy bar grows from the left edge over the footage and names the chapter ───────────────
// text, n (chapter number, optional). The footage around the words shows through (the kit's ground).
HZ.tab = function (L, holder) {
  const TAB = (() => { const x1 = .40, y1 = .70, x2 = .15, y2 = 1; return u => { let s = u; for (let i = 0; i < 14; i++) { const x = 3 * (1 - s) * (1 - s) * s * x1 + 3 * (1 - s) * s * s * x2 + s * s * s - u, dx = 3 * (1 - s) * (1 - s) * x1 + 6 * (1 - s) * s * (x2 - x1) + 3 * s * s * (1 - x2); if (Math.abs(dx) < 1e-6) break; s = clamp(s - x / dx); } return 3 * (1 - s) * (1 - s) * s * y1 + 3 * (1 - s) * s * s * y2 + s * s * s; }; })();
  if (!S.ground) holder.style.background = HNAVY;
  hEl('div', 'position:absolute;inset:0;background:linear-gradient(90deg,rgba(0,0,0,.45),rgba(0,0,0,0) 60%)', holder);
  const bar = hEl('div', 'position:absolute;left:97px;top:895px;height:79px;width:0;background:#0B2033;overflow:hidden;box-shadow:0 8px 30px rgba(0,0,0,.4)', holder);
  const inner = hEl('div', 'position:absolute;left:28px;top:0;height:79px;display:flex;align-items:center;gap:18px;white-space:nowrap', bar);
  if (L.n != null) hEl('div', 'font:600 26px/1 PO;color:#8FD3FF;letter-spacing:.08em', inner, esc(String(L.n).padStart(2, '0')));
  hEl('div', 'font:600 29px/1 PO;letter-spacing:.05em;color:#E6FFFF;text-transform:uppercase', inner, esc(L.text || ''));
  const wmax = Math.min(1200, 120 + 21 * String(L.text || '').length + (L.n != null ? 60 : 0));
  return t => {
    const p = TAB(seg(t, 0.1, 1.73)), q = 1 - seg(t, D - 0.45, D - 0.05);
    bar.style.width = (wmax * p) + 'px'; bar.style.opacity = q;
    if (S.ground) ground.style.transform = `scale(${1.04 + 0.03 * seg(t, 0, D)})`;
  };
};

let _hf = null;
function build() {
  const f = HZ[S.type];
  if (!f) throw new Error('horizon: unknown scene ' + S.type);
  if (S.error) throw new Error(S.error);
  _hf = f(S, scene);
}
function frame(t) { if (_hf) _hf(t); }
