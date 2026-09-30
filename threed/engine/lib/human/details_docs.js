// details_docs.js — documents for the DETAIL kit (E3, 2026-09-27): canvas paper with period typography from the engine
// fonts, every text a param. Handwriting = EB Garamond Italic with per-letter jitter (pencil grain or blue-black ink);
// type = Special Elite / Courier Prime; print = EB Garamond + Cinzel. `write: [t0, t1]` reveals the handwriting letter
// by letter, `flood: [t0, t1]` fills the plan's flooded compartments, `draw: [t0, t1]` draws the chart's route.
import * as THREE from 'three';
import { TAU, clamp, lerp, smooth, smoother, makeRng, DEG, FAM, font, canvas, ctex, rgba, normalFrom, phys, std, metal, mesh, sheetGeo, blob, num } from './details_core.js';

// ── paper ───────────────────────────────────────────────────────────────────────────────────────────────────────────
function paper(W, H, o = {}) {
  const [c, g] = canvas(W, H), R = makeRng(o.seed || 11), tone = o.tone || '#EFE7D4';
  g.fillStyle = tone; g.fillRect(0, 0, W, H);
  for (let i = 0; i < (W * H) / 900; i++) { g.fillStyle = `rgba(${R() < 0.5 ? '120,100,70' : '255,252,240'},${0.03 + R() * 0.05})`; const x = R() * W, y = R() * H, a = R() * TAU, l = 3 + R() * 14; g.save(); g.translate(x, y); g.rotate(a); g.fillRect(0, 0, l, 1); g.restore(); }
  const age = clamp(num(o.age, 0.35));
  const ed = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.56); ed.addColorStop(0, 'rgba(140,100,40,0)'); ed.addColorStop(1, `rgba(140,100,40,${0.28 * age})`); g.fillStyle = ed; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 14 * age; i++) { const x = R() * W, y = R() * H, r = 4 + R() * 26, gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(150,105,50,${0.12 + R() * 0.12})`); gr.addColorStop(1, 'rgba(150,105,50,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
  if (o.fold) for (const f of o.fold) { const y = f * H; const gr = g.createLinearGradient(0, y - 18, 0, y + 18); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.5, 'rgba(90,70,40,0.16)'); gr.addColorStop(0.52, 'rgba(255,250,235,0.2)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, y - 18, W, 36); }
  return [c, g];
}
// wrapped handwriting: glyph boxes with a per-letter jitter (the hand), words wrap at maxW
function handLayout(g, text, x0, y0, maxW, px, lh, o = {}) {
  const R = makeRng(o.seed || 9), out = [];
  g.font = font(o.weight || 450, px, o.fam || FAM.serif, o.italic !== false);
  let x = x0, y = y0;
  const lines = String(text).split(/\n|\|/);
  for (let li = 0; li < lines.length; li++) {
    const words = lines[li].split(/(\s+)/);
    for (const w of words) {
      if (!w) continue;
      const ww = g.measureText(w).width * 1.02;
      if (/^\s+$/.test(w)) { x += ww; continue; }
      if (x + ww > x0 + maxW && x > x0) { x = x0 + (R() - 0.5) * px * 0.2; y += lh; }
      for (const ch of w) { const cw = g.measureText(ch).width; out.push({ ch, x, y: y + (R() - 0.5) * px * 0.07 + Math.sin(x * 0.01) * px * 0.03, rot: (R() - 0.5) * 0.07, sc: 0.95 + R() * 0.1, w: cw, a: 0.8 + R() * 0.2 }); x += cw * (0.98 + R() * 0.05); }
    }
    x = x0; y += lh;
  }
  return out;
}
function drawGlyphs(g, gl, o) {
  g.save(); g.font = font(o.weight || 450, o.px, o.fam || FAM.serif, o.italic !== false); g.textBaseline = 'alphabetic';
  for (const q of gl) { g.save(); g.translate(q.x, q.y); g.rotate(q.rot); g.scale(q.sc, q.sc); g.fillStyle = rgba(o.color, q.a * (o.alpha ?? 1)); g.fillText(q.ch, 0, 0); if (o.bold) g.fillText(q.ch, o.bold, 0); g.restore(); }
  g.restore();
}
// a text layer that can be revealed letter by letter over a static base (both canvases), -> {tex, update(t, write)}
function revealDoc(base, layer, glyphs, px) {
  const [c, g] = canvas(base.width, base.height);
  const tex = ctex(c);
  let last = -1;
  const paint = (n) => {
    g.drawImage(base, 0, 0);
    if (n >= glyphs.length) { g.drawImage(layer, 0, 0); }
    else if (n > 0) {
      g.save(); g.beginPath();
      const k = Math.floor(n), f = n - k;
      for (let i = 0; i < k; i++) { const q = glyphs[i]; g.rect(q.x - px * 0.3, q.y - px * 1.1, q.w * 1.1 + px * 0.35, px * 1.5); }
      if (k < glyphs.length && f > 0) { const q = glyphs[k]; g.rect(q.x - px * 0.3, q.y - px * 1.1, (q.w * 1.1 + px * 0.3) * f, px * 1.5); }
      g.clip(); g.drawImage(layer, 0, 0); g.restore();
    }
    tex.needsUpdate = true;
  };
  paint(glyphs.length);
  return {
    tex, canvas: c,
    update(t, write) {
      if (!Array.isArray(write) || write.length < 2) { if (last !== -2) { paint(glyphs.length); last = -2; } return; }
      const n = glyphs.length * clamp((t - write[0]) / Math.max(0.05, write[1] - write[0]));
      const q = Math.round(n * 4) / 4; if (q !== last) { paint(q); last = q; }
    },
  };
}
function pencilGrain(layer, seed = 3) {
  const g = layer.getContext('2d'), R = makeRng(seed); g.save(); g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < layer.width * layer.height / 60; i++) { g.fillStyle = `rgba(0,0,0,${0.2 + R() * 0.5})`; g.fillRect(R() * layer.width, R() * layer.height, 1 + R() * 2, 1); }
  g.restore();
}

// ── the wireless form (detail.wireless's pad) ─────────────────────────────────────────────────────────────────────
function wireless_form(o) {
  const W = 2048, H = 1488, [base, g] = paper(W, H, { tone: '#F1EAD8', age: 0.2, seed: 4 });
  const ink = '#2C3A5C';
  g.fillStyle = ink; g.strokeStyle = ink; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  g.font = font(700, 74, FAM.caps); g.letterSpacing = '10px'; g.fillText(String(o.header ?? 'WIRELESS TELEGRAM').toUpperCase(), W / 2, 130); g.letterSpacing = '0px';
  g.font = font(500, 34, FAM.serif, true); g.fillText(o.subheader ?? 'Marine Radio-Telegraph Service  ·  Form No. 1', W / 2, 184);
  g.lineWidth = 4; g.beginPath(); g.moveTo(90, 214); g.lineTo(W - 90, 214); g.stroke(); g.lineWidth = 1.5; g.beginPath(); g.moveTo(90, 224); g.lineTo(W - 90, 224); g.stroke();
  g.textAlign = 'left'; g.font = font(500, 36, FAM.serif);
  const field = (label, x, y, w) => { g.fillText(label, x, y); const lw = g.measureText(label).width; g.setLineDash([4, 7]); g.lineWidth = 2; g.beginPath(); g.moveTo(x + lw + 12, y + 6); g.lineTo(x + w, y + 6); g.stroke(); g.setLineDash([]); return x + lw + 24; };
  const fx1 = field('Office of Origin', 90, 300, 1000), fx2 = field('Words', 1130, 300, 1500), fx3 = field('Time', 1560, 300, W - 90);
  const fx4 = field('To', 90, 380, W - 90);
  g.lineWidth = 2; for (let k = 0; k < 7; k++) { const y = 520 + k * 128; g.beginPath(); g.moveTo(90, y); g.lineTo(W - 90, y); g.stroke(); }
  g.font = font(500, 26, FAM.serif, true); g.textAlign = 'center'; g.fillText('The Company is not liable for any error or delay in the transmission of this message.', W / 2, H - 70);
  // handwriting (pencil) in the fields and on the ruled lines
  const [layer, lg] = canvas(W, H), pencil = (o.hand || 'pencil') === 'pencil', typed = o.hand === 'typed';
  const col = pencil ? '#2B2B30' : typed ? '#1A1A1C' : '#1E2A4E';
  const fam = typed ? FAM.type : FAM.serif, it = !typed, px = typed ? 62 : 74;
  const all = [];
  const put = (s, x, y, w, sd) => { const gl = handLayout(lg, s, x, y, w, px, 128, { seed: sd, fam, italic: it }); all.push(...gl); };
  put(String(o.from ?? 'TITANIC'), fx1, 294, 560, 1); put(String(o.words ?? ''), fx2, 294, 300, 2); put(String(o.time ?? '11.45 PM'), fx3, 294, 400, 3);
  put(String(o.to ?? 'ALL SHIPS'), fx4, 374, 1200, 4);
  put(typed ? String(o.text).toUpperCase() : String(o.text), 110, 500, W - 260, 5);
  drawGlyphs(lg, all, { px, color: col, fam, italic: it, weight: pencil ? 500 : 450, bold: pencil ? 1.4 : 0 });
  if (pencil) pencilGrain(layer, 6);
  return revealDoc(base, layer, all, px);
}

// ── ship plan (linen or blueprint): side elevation, watertight bulkheads, flooded compartments ───────────────────
function shipPlan(o) {
  const W = 4096, H = 1640, blue = o.style === 'blueprint';
  const [base, g] = blue ? canvas(W, H) : paper(W, H, { tone: '#E8DFC6', age: 0.3, seed: 12 });
  if (blue) { g.fillStyle = '#1D3F72'; g.fillRect(0, 0, W, H); const R = makeRng(2); for (let i = 0; i < 30000; i++) { g.fillStyle = `rgba(255,255,255,${R() * 0.03})`; g.fillRect(R() * W, R() * H, 2, 2); } }
  const ink = blue ? 'rgba(235,242,255,0.92)' : 'rgba(34,30,24,0.92)';
  g.strokeStyle = ink; g.fillStyle = ink; g.lineJoin = 'round';
  g.lineWidth = 6; g.strokeRect(50, 50, W - 100, H - 100); g.lineWidth = 2; g.strokeRect(66, 66, W - 132, H - 132);
  // hull geometry (bow to the right): keel y, deck y, stern x, bow x
  const xS = 330, xB = 3820, yK = 1080, yD = 700, yBD = 820;   // yBD: the bulkhead deck
  const sheer = (x) => yD - 38 * Math.pow((x - (xS + xB) / 2) / ((xB - xS) / 2), 2);
  const hull = new Path2D();
  hull.moveTo(xS + 40, sheer(xS + 40)); for (let x = xS + 40; x <= xB; x += 20) hull.lineTo(x, sheer(x));
  hull.lineTo(xB + 60, sheer(xB) - 6); hull.quadraticCurveTo(xB + 30, yK - 150, xB - 30, yK);   // raked stem
  hull.lineTo(xS + 170, yK); hull.quadraticCurveTo(xS + 60, yK - 40, xS + 30, yK - 200); hull.quadraticCurveTo(xS - 40, sheer(xS) + 60, xS + 40, sheer(xS + 40));   // counter stern
  hull.closePath();
  const n = Math.max(3, Math.min(24, Math.round(num(o.compartments, 16))));
  const bx = []; for (let k = 0; k <= n; k++) bx.push(lerp(xS + 120, xB - 50, k / n));   // bulkhead x (0 = aft .. n = fore)
  // flooded: K compartments from the bow, or a list of indices counted from the bow (0 = forepeak)
  const fl = Array.isArray(o.flooded) ? o.flooded.map(Number) : [...Array(Math.max(0, Math.min(n, Math.round(num(o.flooded, 6))))).keys()];
  // superstructure, funnels, masts (drawn once)
  g.lineWidth = 4;
  const decks = [[yD - 70, 1000, 3100], [yD - 130, 1120, 2900], [yD - 180, 1300, 2700]];
  for (const [y, a, b] of decks) { g.strokeRect(a, y, b - a, (y === yD - 70 ? sheer(a) - y : 60)); }
  const nf = Math.max(1, Math.min(4, Math.round(num(o.funnels, 4))));
  for (let k = 0; k < nf; k++) { const x = lerp(2800, 1450, nf > 1 ? k / (nf - 1) : 0.5), top = yD - 520; g.beginPath(); g.moveTo(x - 60, yD - 180); g.lineTo(x - 60 - 50, top); g.lineTo(x + 60 - 50, top); g.lineTo(x + 60, yD - 180); g.stroke(); g.fillStyle = blue ? 'rgba(235,242,255,0.3)' : 'rgba(34,30,24,0.75)'; g.fillRect(x - 108, top, 118, 60); g.fillStyle = ink; }
  g.lineWidth = 3; for (const x of [3350, 900]) { g.beginPath(); g.moveTo(x, yD - 40); g.lineTo(x - 30, yD - 640); g.stroke(); }
  // portholes, the load water line
  for (let x = xS + 260; x < xB - 150; x += 34) { g.beginPath(); g.arc(x, sheer(x) + 58, 5, 0, TAU); g.stroke(); }
  g.setLineDash([26, 14]); g.lineWidth = 2.5; g.beginPath(); g.moveTo(xS - 20, yK - 160); g.lineTo(xB + 80, yK - 160); g.stroke(); g.setLineDash([]);
  g.font = font(500, 34, FAM.serif, true); g.fillText('Load water line', xB - 520, yK - 175);
  // labels
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = font(600, 40, FAM.serif);
  for (let k = 0; k < n; k++) { const from = n - 1 - k; g.fillText(k === n - 1 ? 'Fore peak' : k === 0 ? 'Aft peak' : String(from), (bx[k] + bx[k + 1]) / 2, yK - 60); }
  g.font = font(700, 36, FAM.caps); for (let k = 1; k < n; k++) g.fillText(String.fromCharCode(64 + Math.min(26, n - k)), bx[k], yK + 50);
  g.font = font(700, 96, FAM.caps); g.textAlign = 'left'; g.letterSpacing = '18px'; g.fillText(String(o.name ?? 'R.M.S. TITANIC').toUpperCase(), 130, 190); g.letterSpacing = '0px';
  g.font = font(500, 44, FAM.serif, true); g.fillText(o.subtitle ?? 'Longitudinal section, shewing watertight bulkheads', 136, 262);
  g.textAlign = 'right'; g.font = font(600, 38, FAM.serif); g.fillText(o.note ?? 'Watertight bulkheads carried to the bulkhead deck', W - 130, 190);
  // scale bar + title block
  g.textAlign = 'center'; g.lineWidth = 3; g.strokeRect(130, H - 250, 800, 26); for (let k = 0; k < 4; k++) if (k % 2 === 0) g.fillRect(130 + k * 200, H - 250, 200, 26);
  g.font = font(500, 34, FAM.serif); ['0', '100', '200', '300', '400 feet'].forEach((s, k) => g.fillText(s, 130 + k * 200, H - 190));
  g.strokeRect(W - 1030, H - 330, 900, 220); g.font = font(700, 44, FAM.caps); g.fillText(String(o.title ?? 'PROFILE & BULKHEADS').toUpperCase(), W - 580, H - 270); g.font = font(500, 34, FAM.serif, true); g.fillText(o.drawn ?? 'Drawing Office, Belfast · Scale 1/32 in. = 1 ft', W - 580, H - 205); g.fillText(o.date ?? '1911', W - 580, H - 155);
  // the static layer is everything but the water; the hull outline + bulkheads are drawn over the water each frame
  const [over, og] = canvas(W, H); og.strokeStyle = ink; og.lineWidth = 7; og.stroke(hull);
  og.lineWidth = 5; for (let k = 1; k < n; k++) { const x = bx[k]; og.beginPath(); og.moveTo(x, yK); og.lineTo(x, yBD - (k > n * 0.8 ? 40 : 0)); og.stroke(); }
  og.lineWidth = 3; og.beginPath(); og.moveTo(xS + 60, yBD); og.lineTo(xB - 10, yBD - 30); og.stroke();
  og.font = font(500, 30, FAM.serif, true); og.fillStyle = ink; og.fillText('Bulkhead deck', xS + 120, yBD - 16);
  const [c, cg] = canvas(W, H), tex = ctex(c);
  const water = blue ? 'rgba(120,200,255,0.55)' : 'rgba(46,110,160,0.5)';
  let last = -1;
  const paint = (k) => {
    cg.drawImage(base, 0, 0);
    if (k > 0) {
      cg.save(); cg.clip(hull);
      for (const i of fl) {
        const a = bx[n - 1 - i], b = bx[n - i]; if (a == null || b == null) continue;
        const lvl = lerp(yK, yBD - 10, clamp(k * (1 - i * 0.05)));
        cg.fillStyle = water; cg.fillRect(a, lvl, b - a, yK - lvl + 4);
        cg.strokeStyle = blue ? 'rgba(200,235,255,0.8)' : 'rgba(30,70,120,0.8)'; cg.lineWidth = 3; cg.beginPath(); for (let x = a; x <= b; x += 12) cg.lineTo(x, lvl + Math.sin(x * 0.05) * 3); cg.stroke();
        cg.strokeStyle = blue ? 'rgba(200,235,255,0.35)' : 'rgba(30,70,120,0.3)'; cg.lineWidth = 2; for (let y = lvl + 24; y < yK; y += 24) { cg.beginPath(); cg.moveTo(a, y); cg.lineTo(b, y); cg.stroke(); }
      }
      cg.restore();
    }
    cg.drawImage(over, 0, 0);
    if (k > 0.3 && fl.length) { cg.fillStyle = blue ? '#FFFFFF' : '#7A1E16'; cg.font = font(700, 46, FAM.caps); cg.textAlign = 'center'; cg.globalAlpha = clamp((k - 0.3) / 0.3); const i0 = Math.min(...fl), i1 = Math.max(...fl); cg.fillText(String(o.flood_label ?? `${fl.length} COMPARTMENTS OPEN TO THE SEA`), (bx[n - 1 - i1] + bx[n - i0]) / 2, yK + 130); cg.globalAlpha = 1; }
    tex.needsUpdate = true;
  };
  return { tex, update(t) { const f = Array.isArray(o.flood) && o.flood.length >= 2 ? smooth((t - o.flood[0]) / Math.max(0.1, o.flood[1] - o.flood[0])) : 1; const q = Math.round(f * 60) / 60; if (q !== last) { paint(q); last = q; } }, paint };
}

// ── letter (handwritten, ink) ──────────────────────────────────────────────────────────────────────────────────────
function letter(o) {
  const W = 2048, H = 2662, [base, g] = paper(W, H, { tone: '#F2ECDD', age: num(o.age, 0.3), seed: 21, fold: [1 / 3, 2 / 3] });
  const ink = o.ink || '#1E2A4E';
  if (o.header) { g.fillStyle = '#6A2A1E'; g.textAlign = 'center'; g.font = font(700, 58, FAM.caps); g.letterSpacing = '8px'; g.fillText(String(o.header).toUpperCase(), W / 2, 200); g.letterSpacing = '0px'; g.strokeStyle = '#6A2A1E'; g.lineWidth = 2; g.beginPath(); g.moveTo(W / 2 - 300, 236); g.lineTo(W / 2 + 300, 236); g.stroke(); }
  const [layer, lg] = canvas(W, H), px = 96, all = [];
  all.push(...handLayout(lg, String(o.date ?? 'April 14th, 1912'), W - 860, 380, 760, px, 130, { seed: 2 }));
  const body = String(o.text ?? 'My dearest,|We are making splendid time and all aboard are in the best of spirits. The weather is fine and cold. I shall write again from New York.');
  all.push(...handLayout(lg, o.salutation ? String(o.salutation) + '|' + body : body, 170, 600, W - 340, px, 140, { seed: 3 }));
  const last = all.length ? all[all.length - 1].y : 900;
  const sig = handLayout(lg, String(o.signature ?? 'Ever yours, T.'), W - 900, Math.min(H - 220, last + 230), 760, px * 1.12, 118, { seed: 4 });
  all.push(...sig);
  drawGlyphs(lg, all, { px, color: ink, weight: 450, bold: 1.1 });
  if (sig.length) { lg.strokeStyle = rgba(ink, 0.85); lg.lineWidth = 4; lg.beginPath(); const s0 = sig[0], s1 = sig[sig.length - 1]; lg.moveTo(s0.x, s1.y + 26); lg.bezierCurveTo(s0.x + 200, s1.y + 60, s1.x + 50, s1.y + 10, s1.x + 140, s1.y - 40); lg.stroke(); }
  return revealDoc(base, layer, all, px);
}
// ── telegram (typed strips pasted on a printed form) ────────────────────────────────────────────────────────────────
function telegram(o) {
  const W = 2048, H = 1400, [base, g] = paper(W, H, { tone: '#EDE3C8', age: 0.25, seed: 31 });
  const ink = '#3A2A20';
  g.fillStyle = ink; g.strokeStyle = ink; g.textAlign = 'center';
  g.font = font(800, 150, FAM.serif); g.letterSpacing = '24px'; g.fillText(String(o.header ?? 'TELEGRAM').toUpperCase(), W / 2, 210); g.letterSpacing = '0px';
  g.font = font(500, 36, FAM.serif, true); g.fillText(o.subheader ?? 'Received at the Cable Office', W / 2, 270);
  g.lineWidth = 5; g.beginPath(); g.moveTo(100, 300); g.lineTo(W - 100, 300); g.stroke();
  g.textAlign = 'left'; g.font = font(500, 34, FAM.serif);
  const fld = [['Office of Origin', 110, 370], ['Handed in at', 820, 370], ['Received', 1450, 370]];
  for (const [s, x, y] of fld) { g.fillText(s, x, y); g.setLineDash([3, 6]); g.lineWidth = 2; g.beginPath(); g.moveTo(x + g.measureText(s).width + 10, y + 6); g.lineTo(x + 560, y + 6); g.stroke(); g.setLineDash([]); }
  g.fillText('To', 110, 470); g.beginPath(); g.moveTo(160, 476); g.lineTo(W - 110, 476); g.stroke();
  g.font = font(500, 26, FAM.serif, true); g.textAlign = 'center'; g.fillText('No inquiry respecting this telegram can be attended to without the production of this form.', W / 2, H - 60);
  // typed strips: white paper strips pasted across the form, typed caps
  const R = makeRng(7), px = 58, strips = [];
  g.font = font(400, px, FAM.type);
  const words = String(o.text ?? 'REGRET TO INFORM YOU TITANIC SANK THIS MORNING AFTER COLLISION WITH ICEBERG STOP').toUpperCase().split(/\s+/);
  let line = '', lines = [];
  for (const w of words) { const t = line ? line + ' ' + w : w; if (g.measureText(t).width > W - 420 && line) { lines.push(line); line = w; } else line = t; }
  if (line) lines.push(line);
  if (o.signature) lines.push('= ' + String(o.signature).toUpperCase() + ' =');
  const [layer, lg] = canvas(W, H), all = [];
  lines.slice(0, 7).forEach((s, i) => {
    const y = 600 + i * 108, x = 200 + (R() - 0.5) * 30, rot = (R() - 0.5) * 0.012;
    g.font = font(400, px, FAM.type); const w = g.measureText(s).width + 70;
    g.save(); g.translate(x, y); g.rotate(rot);
    g.fillStyle = 'rgba(60,40,20,0.18)'; g.fillRect(-26, -px * 0.95 + 5, w, px * 1.45);
    g.fillStyle = '#F7F3EA'; g.fillRect(-30, -px * 0.95, w, px * 1.45); g.restore();
    const gl = handLayout(lg, s, x, y, W, px, 108, { seed: 40 + i, fam: FAM.type, italic: false, weight: 400 }); for (const q of gl) { q.rot = rot + (R() - 0.5) * 0.02; q.y = y + (q.x - x) * rot + (R() - 0.5) * 2; q.a = 0.75 + R() * 0.25; } all.push(...gl);
  });
  drawGlyphs(lg, all, { px, color: '#161412', fam: FAM.type, italic: false, weight: 400 });
  const hand = handLayout(lg, String(o.from ?? 'NEW YORK'), 110 + 300, 362, 380, 56, 60, { seed: 5 }).concat(handLayout(lg, String(o.date ?? '15 AP 12'), 820 + 250, 362, 300, 56, 60, { seed: 6 }), handLayout(lg, String(o.to ?? 'MRS. E. SMITH, SOUTHAMPTON'), 190, 462, 1400, 56, 60, { seed: 8 }));
  drawGlyphs(lg, hand, { px: 56, color: '#1E2A4E', weight: 450 });
  return revealDoc(base, layer, all.concat(hand), px);
}
// ── newspaper front page (the top half of a broadsheet) ─────────────────────────────────────────────────────────────
function newspaper(o) {
  const W = 2048, H = 2740, [base, g] = paper(W, H, { tone: '#E9E1CC', age: num(o.age, 0.45), seed: 41, fold: [0.97] });
  const ink = '#1A1814', R = makeRng(43);
  g.fillStyle = ink; g.strokeStyle = ink; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  // ears + masthead
  g.lineWidth = 3; g.strokeRect(70, 70, 300, 170); g.strokeRect(W - 370, 70, 300, 170);
  g.font = font(700, 40, FAM.caps); g.fillText(String(o.edition ?? 'EXTRA').toUpperCase(), 220, 150); g.font = font(500, 32, FAM.serif, true); g.fillText(o.ear_left ?? 'Latest News', 220, 200);
  g.font = font(700, 40, FAM.caps); g.fillText(String(o.price ?? 'ONE CENT').toUpperCase(), W - 220, 150); g.font = font(500, 32, FAM.serif, true); g.fillText(o.ear_right ?? 'Weather: Fair', W - 220, 200);
  const mh = String(o.masthead ?? 'The Evening Chronicle');
  let mpx = 190; g.font = font(800, mpx, FAM.serif); while (g.measureText(mh).width > W - 800 && mpx > 60) { mpx -= 6; g.font = font(800, mpx, FAM.serif); }
  g.fillText(mh, W / 2, 225);
  g.lineWidth = 6; g.beginPath(); g.moveTo(60, 280); g.lineTo(W - 60, 280); g.stroke(); g.lineWidth = 2; g.beginPath(); g.moveTo(60, 292); g.lineTo(W - 60, 292); g.stroke();
  g.font = font(600, 36, FAM.serif); g.textAlign = 'left'; g.fillText(String(o.volume ?? 'VOL. LII. NO. 18,436'), 70, 335); g.textAlign = 'center'; g.fillText(String(o.date ?? 'MONDAY, APRIL 15, 1912').toUpperCase(), W / 2, 335); g.textAlign = 'right'; g.fillText(String(o.pages ?? 'TWENTY-FOUR PAGES'), W - 70, 335);
  g.lineWidth = 2; g.beginPath(); g.moveTo(60, 358); g.lineTo(W - 60, 358); g.stroke(); g.lineWidth = 6; g.beginPath(); g.moveTo(60, 370); g.lineTo(W - 60, 370); g.stroke();
  // headline: condensed heavy serif caps, up to 3 lines, fitted
  const hl = String(o.headline ?? 'TITANIC SINKS FOUR HOURS AFTER HITTING ICEBERG').toUpperCase();
  let hpx = 200; const fit = () => { g.font = font(800, hpx, FAM.serif); const ws = hl.split(/\s+/); const ls = []; let l = ''; for (const w of ws) { const t = l ? l + ' ' + w : w; if (g.measureText(t).width * 0.78 > W - 160 && l) { ls.push(l); l = w; } else l = t; } if (l) ls.push(l); return ls; };
  let hls = fit(); while ((hls.length > 3 || hls.length * hpx * 1.02 > 720) && hpx > 70) { hpx -= 8; hls = fit(); }
  g.textAlign = 'center'; let y = 380 + hpx * 0.95;
  for (const s of hls) { g.save(); g.translate(W / 2, y); g.scale(0.78, 1); g.fillText(s, 0, 0); g.restore(); y += hpx * 1.02; }
  y += 10; g.lineWidth = 3; g.beginPath(); g.moveTo(300, y); g.lineTo(W - 300, y); g.stroke(); y += 70;
  const sub = String(o.subhead ?? '1,500 LOST; 745 SAVED BY THE CARPATHIA').toUpperCase().split(/\n|\|/);
  g.font = font(700, 62, FAM.serif); for (const s of sub) { g.save(); g.translate(W / 2, y); g.scale(0.85, 1); g.fillText(s, 0, 0); g.restore(); y += 76; }
  y += 10; g.lineWidth = 2; g.beginPath(); g.moveTo(60, y); g.lineTo(W - 60, y); g.stroke();
  // six columns of body text; a halftone photograph of a liner in columns 2-4
  const cols = 6, cw = (W - 120) / cols, top = y + 20, pic = { x0: 60 + cw, x1: 60 + cw * 4, y0: top + 30, y1: top + 620 };
  g.lineWidth = 1.5; for (let k = 1; k < cols; k++) { g.beginPath(); g.moveTo(60 + k * cw, top); g.lineTo(60 + k * cw, H - 60); g.stroke(); }
  // halftone photo
  g.fillStyle = '#C9C1AE'; g.fillRect(pic.x0 + 16, pic.y0, pic.x1 - pic.x0 - 32, pic.y1 - pic.y0);
  { const [pc, pg] = canvas(pic.x1 - pic.x0 - 32, pic.y1 - pic.y0); const pw = pc.width, ph = pc.height; const sky = pg.createLinearGradient(0, 0, 0, ph); sky.addColorStop(0, '#B8B8B8'); sky.addColorStop(0.62, '#E8E8E8'); sky.addColorStop(0.64, '#6A6A6A'); sky.addColorStop(1, '#3A3A3A'); pg.fillStyle = sky; pg.fillRect(0, 0, pw, ph);
    pg.fillStyle = '#141414'; pg.beginPath(); pg.moveTo(pw * 0.08, ph * 0.56); pg.lineTo(pw * 0.93, ph * 0.54); pg.lineTo(pw * 0.9, ph * 0.66); pg.lineTo(pw * 0.12, ph * 0.66); pg.closePath(); pg.fill();
    pg.fillStyle = '#E4E4E4'; pg.fillRect(pw * 0.25, ph * 0.5, pw * 0.52, ph * 0.055); pg.fillStyle = '#202020'; for (let k = 0; k < 4; k++) { const x = pw * (0.32 + k * 0.12); pg.save(); pg.translate(x, ph * 0.5); pg.transform(1, 0, -0.12, 1, 0, 0); pg.fillRect(-pw * 0.025, -ph * 0.2, pw * 0.05, ph * 0.2); pg.restore(); }
    const id = pg.getImageData(0, 0, pw, ph).data; g.fillStyle = '#1A1814'; const st = 7;
    for (let yy = 0; yy < ph; yy += st) for (let xx = (yy / st) % 2 ? st / 2 : 0; xx < pw; xx += st) { const v = 1 - id[(Math.floor(yy) * pw + Math.floor(xx)) * 4] / 255; if (v > 0.03) { g.beginPath(); g.arc(pic.x0 + 16 + xx, pic.y0 + yy, st * 0.62 * Math.sqrt(v), 0, TAU); g.fill(); } } }
  g.fillStyle = ink; g.font = font(600, 30, FAM.serif, true); g.textAlign = 'center'; g.fillText(String(o.caption ?? 'The lost liner, photographed on her departure from Southampton.'), (pic.x0 + pic.x1) / 2, pic.y1 + 44);
  const syl = ['the', 'of', 'and', 'ship', 'was', 'in', 'to', 'at', 'with', 'from', 'her', 'passengers', 'last', 'night', 'wireless', 'report', 'said', 'captain', 'water', 'boats', 'lost', 'by', 'news', 'line', 'officers', 'which', 'had', 'been', 'is', 'on', 'New', 'York', 'that', 'were', 'crew', 'all', 'women', 'first', 'message', 'received', 'early', 'this', 'morning'];
  g.textAlign = 'left'; g.font = font(450, 25, FAM.serif);
  for (let k = 0; k < cols; k++) {
    const x = 60 + k * cw + 14, w = cw - 28; let yy = top + 34;
    if (k >= 1 && k <= 3) yy = pic.y1 + 90;
    if (k === 0 || k === 4) { g.font = font(700, 32, FAM.serif); g.textAlign = 'center'; g.fillText(k === 0 ? String(o.col1 ?? 'LINER STRUCK AT 11.40') : String(o.col5 ?? 'LIST OF SAVED'), x + w / 2, yy); yy += 20; g.lineWidth = 1.2; g.beginPath(); g.moveTo(x + w * 0.3, yy); g.lineTo(x + w * 0.7, yy); g.stroke(); yy += 36; g.textAlign = 'left'; g.font = font(450, 25, FAM.serif); }
    while (yy < H - 70) { let s = '', ww = 0; while (true) { const wd = syl[Math.floor(R() * syl.length)]; const t2 = s ? s + ' ' + wd : wd; if (g.measureText(t2).width > w) break; s = t2; ww++; } g.fillStyle = `rgba(26,24,20,${0.7 + R() * 0.2})`; g.fillText(s, x, yy); yy += 31; if (R() < 0.05) yy += 16; }
  }
  return { tex: ctex(base), update() {} };
}
// ── chart: parchment, graticule, a coast, the route (drawn over time) to a marked point ─────────────────────────────
function chart(o) {
  const W = 2560, H = 1940, [base, g] = paper(W, H, { tone: '#E6DCC0', age: 0.5, seed: 51 });
  const ink = '#3A2E22', R = makeRng(52);
  // lat/lon grid (lon0..lon1 W, lat0..lat1 N)
  const [lo0, lo1] = Array.isArray(o.lon) ? o.lon : [60, 38], [la0, la1] = Array.isArray(o.lat) ? o.lat : [36, 50];
  const X = (lon) => lerp(140, W - 140, (lo0 - lon) / (lo0 - lo1)), Y = (lat) => lerp(H - 140, 140, (lat - la0) / (la1 - la0));
  g.strokeStyle = rgba(ink, 0.9); g.lineWidth = 5; g.strokeRect(100, 100, W - 200, H - 200); g.lineWidth = 2; g.strokeRect(118, 118, W - 236, H - 236);
  g.lineWidth = 1.4; g.strokeStyle = rgba(ink, 0.45); g.fillStyle = ink; g.font = font(500, 30, FAM.serif); g.textAlign = 'center';
  for (let lon = Math.ceil(lo1 / 2) * 2; lon <= lo0; lon += 2) { const x = X(lon); g.beginPath(); g.moveTo(x, 118); g.lineTo(x, H - 118); g.stroke(); g.fillText(`${lon}°W`, x, H - 70); }
  for (let lat = Math.ceil(la0 / 2) * 2; lat <= la1; lat += 2) { const y = Y(lat); g.beginPath(); g.moveTo(118, y); g.lineTo(W - 118, y); g.stroke(); g.save(); g.translate(70, y); g.rotate(-Math.PI / 2); g.fillText(`${lat}°N`, 0, 0); g.restore(); }
  // a coast (Newfoundland-like) in the upper left, soundings
  g.fillStyle = '#D6C7A0'; g.strokeStyle = rgba(ink, 0.9); g.lineWidth = 3;
  const coast = new Path2D(); coast.moveTo(118, Y(47.6)); let cx = X(59.5), cy = Y(47.2); coast.lineTo(118, Y(47.6));
  const pts = [[59, 47.3], [57, 46.8], [55.5, 46.6], [54, 46.8], [53, 46.6], [52.6, 47.6], [53.2, 48.5], [53.6, 49.6], [55.5, 50.3]];
  for (const [lon, lat] of pts) { const nx = X(lon), ny = Y(lat); for (let k = 1; k <= 6; k++) { const f = k / 6; coast.lineTo(lerp(cx, nx, f) + (R() - 0.5) * 22, lerp(cy, ny, f) + (R() - 0.5) * 22); } cx = nx; cy = ny; }
  coast.lineTo(X(55.5), 118); coast.lineTo(118, 118); coast.closePath(); g.fill(coast); g.stroke(coast);
  for (let k = 1; k <= 3; k++) { g.save(); g.setLineDash([6, 10]); g.strokeStyle = rgba(ink, 0.3); g.lineWidth = 1.5; g.translate(k * 26, k * 22); g.stroke(coast); g.restore(); }
  g.fillStyle = ink; g.font = font(700, 50, FAM.caps); g.textAlign = 'left'; g.letterSpacing = '8px'; g.fillText(String(o.coast ?? 'NEWFOUNDLAND').toUpperCase(), X(58.8), Y(48.6)); g.letterSpacing = '0px';
  g.font = font(500, 26, FAM.serif, true); for (let i = 0; i < 70; i++) { const x = 300 + R() * (W - 600), y = 300 + R() * (H - 600); g.fillStyle = rgba(ink, 0.35); g.fillText(String(Math.floor(1200 + R() * 2600)), x, y); }
  g.font = font(700, 70, FAM.caps); g.textAlign = 'center'; g.letterSpacing = '26px'; g.fillStyle = rgba(ink, 0.8); g.fillText(String(o.title ?? 'NORTH ATLANTIC OCEAN').toUpperCase(), W * 0.6, Y(37.6)); g.letterSpacing = '0px';
  // compass rose
  { const rx = W - 360, ry = H - 380, r = 170; g.save(); g.translate(rx, ry); g.strokeStyle = rgba(ink, 0.8); g.lineWidth = 2; g.beginPath(); g.arc(0, 0, r, 0, TAU); g.stroke(); g.beginPath(); g.arc(0, 0, r * 0.86, 0, TAU); g.stroke();
    for (let k = 0; k < 32; k++) { g.save(); g.rotate(k * TAU / 32); g.beginPath(); g.moveTo(0, -r * 0.86); g.lineTo(0, -r * (k % 4 ? 0.92 : 1)); g.stroke(); g.restore(); }
    for (let k = 0; k < 8; k++) { g.save(); g.rotate(k * TAU / 8); const L = k % 2 ? r * 0.55 : r * 0.84; g.fillStyle = k % 2 ? rgba(ink, 0.5) : ink; g.beginPath(); g.moveTo(0, -L); g.lineTo(r * 0.08, 0); g.lineTo(0, r * 0.04); g.closePath(); g.fill(); g.fillStyle = '#E6DCC0'; g.beginPath(); g.moveTo(0, -L); g.lineTo(-r * 0.08, 0); g.lineTo(0, r * 0.04); g.closePath(); g.fill(); g.stroke(); g.restore(); }
    g.fillStyle = ink; g.font = font(700, 44, FAM.caps); g.textAlign = 'center'; g.fillText('N', 0, -r - 16); g.restore(); }
  // the route and the mark (drawn per frame)
  const route = (Array.isArray(o.route) && o.route.length >= 2 ? o.route : [[49.5, 43.2], [47.2, 42.4], [50.23, 41.77]]).map(([lon, lat]) => [X(+lon), Y(+lat)]);
  const mark = Array.isArray(o.mark) ? [X(+o.mark[0]), Y(+o.mark[1])] : route[route.length - 1];
  if (!Array.isArray(o.route)) { route.length = 0; route.push([X(58), Y(44.6)], [X(54), Y(43.0)], [X(51.5), Y(42.2)], mark.slice()); }
  let L = 0; const seg = []; for (let i = 1; i < route.length; i++) { const d = Math.hypot(route[i][0] - route[i - 1][0], route[i][1] - route[i - 1][1]); seg.push(d); L += d; }
  const [c, cg] = canvas(W, H), tex = ctex(c); let last = -1;
  const paint = (f) => {
    cg.drawImage(base, 0, 0);
    cg.strokeStyle = o.route_color || '#8A1E14'; cg.lineWidth = 7; cg.lineCap = 'round'; cg.setLineDash([28, 16]);
    cg.beginPath(); cg.moveTo(...route[0]); let rem = L * f;
    for (let i = 1; i < route.length && rem > 0; i++) { const k = Math.min(1, rem / seg[i - 1]); cg.lineTo(lerp(route[i - 1][0], route[i][0], k), lerp(route[i - 1][1], route[i][1], k)); rem -= seg[i - 1]; }
    cg.stroke(); cg.setLineDash([]);
    if (f >= 0.999) {
      cg.strokeStyle = '#8A1E14'; cg.lineWidth = 8; cg.beginPath(); cg.arc(mark[0], mark[1], 44, 0, TAU); cg.stroke();
      cg.beginPath(); cg.moveTo(mark[0] - 26, mark[1] - 26); cg.lineTo(mark[0] + 26, mark[1] + 26); cg.moveTo(mark[0] + 26, mark[1] - 26); cg.lineTo(mark[0] - 26, mark[1] + 26); cg.stroke();
      cg.fillStyle = '#5A140E'; cg.textAlign = 'left'; cg.font = font(700, 60, FAM.caps); cg.fillText(String(o.label ?? 'TITANIC SANK HERE').toUpperCase(), mark[0] + 70, mark[1] - 10);
      cg.font = font(500, 46, FAM.serif, true); cg.fillText(String(o.position ?? '41° 46′ N  50° 14′ W'), mark[0] + 72, mark[1] + 56);
    }
    tex.needsUpdate = true;
  };
  return { tex, update(t) { const f = Array.isArray(o.draw) && o.draw.length >= 2 ? smoother((t - o.draw[0]) / Math.max(0.1, o.draw[1] - o.draw[0])) : 1; const q = Math.round(f * 90) / 90; if (q !== last) { paint(q); last = q; } } };
}

// ── detail.papers ─────────────────────────────────────────────────────────────────────────────────────────────────
const SIZES = { ship_plan: [0.9, 0.36], letter: [0.2, 0.26], telegram: [0.21, 0.144], newspaper: [0.42, 0.562], map: [0.5, 0.379] };
async function build(kind, it, ctx, H) {
  const content = SIZES[it.content] ? it.content : 'letter';
  const [w, d] = SIZES[content];
  const big = content === 'ship_plan' || content === 'newspaper' || content === 'map';
  const { root, env, resolveOn } = H.propBase(kind, it, ctx, { surface: 'desk', size: big ? [1.6, 1.0] : [1.2, 0.8], aimY: 0.005, scale: big ? 1.1 : 0.85 });
  const doc = content === 'ship_plan' ? shipPlan(it) : content === 'letter' ? letter(it) : content === 'telegram' ? telegram(it) : content === 'newspaper' ? newspaper(it) : chart(it);
  const docs = new THREE.Group(); docs.name = 'papers'; docs.rotation.y = num(it.turn, content === 'ship_plan' ? 0 : -4) * DEG; root.add(docs);
  const pm = phys({ map: doc.tex, roughness: 0.94, sheen: 0.35, sheenColor: new THREE.Color(0xFFFFFF), sheenRoughness: 0.6 });
  if (content === 'ship_plan') { pm.roughness = 0.88; }
  const sheet = mesh(sheetGeo(w, d, big ? 0.004 : 0.0022, 5, 48), pm, docs, 0, 0.0016, 0); sheet.name = 'paper';
  blob(docs, w * 1.12, d * 1.12, 0.45, 0, 0, 0.0006);
  // what lies with it: a second sheet under, a pencil, dividers, an envelope, a pen
  const R = makeRng(num(it.seed, 1));
  if (it.extras !== false) {
    const under = mesh(sheetGeo(w * 0.98, d * 0.98, 0.0005, 9, 16), std({ color: 0xE6DDC8, roughness: 0.95 }), docs, w * 0.06, 0.0003, -d * 0.05); under.rotation.y = 0.07;
    const pencil = new THREE.Group(); pencil.position.set(w * 0.42, 0.0045, d * 0.3); pencil.rotation.y = 1.9 + R() * 0.3; docs.add(pencil);
    mesh(new THREE.CylinderGeometry(0.0036, 0.0036, 0.15, 6).rotateX(Math.PI / 2), std({ color: 0x2F4A2A, roughness: 0.45 }), pencil);
    mesh(new THREE.ConeGeometry(0.0036, 0.017, 6).rotateX(Math.PI / 2), std({ color: 0xD8B890, roughness: 0.8 }), pencil, 0, 0, 0.0835);
    mesh(new THREE.ConeGeometry(0.0011, 0.005, 12).rotateX(Math.PI / 2), std({ color: 0x2A2A2C, roughness: 0.35, metalness: 0.4 }), pencil, 0, 0, 0.094);
    blob(pencil, 0.02, 0.17, 0.35, 0, 0, -0.004);
    if (content === 'ship_plan' || content === 'map') {                  // brass dividers lying open on the sheet
      const dv = new THREE.Group(); dv.position.set(w * 0.56, 0.004, -d * 0.1); dv.rotation.y = 0.5; docs.add(dv); const br = metal('brass', env), st = metal('steel', env);
      for (const s of [1, -1]) { const leg = new THREE.Group(); leg.rotation.y = s * 0.22; dv.add(leg); mesh(new THREE.BoxGeometry(0.006, 0.004, 0.11), br, leg, 0, 0, 0.055); mesh(new THREE.ConeGeometry(0.0022, 0.03, 8).rotateX(Math.PI / 2), st, leg, 0, 0, 0.125); }
      mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.008, 24), br, dv, 0, 0.002, 0); blob(dv, 0.06, 0.16, 0.3, 0, 0.07, -0.0034);
    }
    if (content === 'letter' || content === 'telegram') {                // an envelope beside it
      const [ec, eg] = canvas(1024, 600); eg.fillStyle = content === 'telegram' ? '#D9C79C' : '#EFE6D2'; eg.fillRect(0, 0, 1024, 600); eg.strokeStyle = 'rgba(90,70,40,0.35)'; eg.lineWidth = 3; eg.beginPath(); eg.moveTo(0, 0); eg.lineTo(512, 330); eg.lineTo(1024, 0); eg.stroke();
      eg.fillStyle = '#1E2A4E'; eg.font = font(450, 64, FAM.serif, true); eg.textAlign = 'center'; eg.fillText(String(it.envelope ?? (content === 'telegram' ? 'TELEGRAM' : '')), 512, 470);
      const env2 = mesh(sheetGeo(0.19, 0.11, 0.0015, 13, 16), std({ map: ctex(ec), roughness: 0.95 }), root, -w * 0.9, 0.001, -d * 0.2); env2.rotation.y = 0.35; blob(root, 0.22, 0.14, 0.3, -w * 0.9, -d * 0.2, 0.0005);
    }
  }
  const txt = anchor0(docs, 'text', 0, 0.002, 0), head = anchor0(docs, 'headline', 0, 0.002, -d * 0.3);
  const update = (t) => { if (resolveOn) resolveOn(); if (doc.update) doc.update(t, it.write); };
  update(0);
  const rd = content === 'ship_plan' ? [w * 0.9, d * 0.55] : content === 'newspaper' ? [w, d * 0.45] : [w, d];   // the readable part: the hull band, the headline block, the sheet
  const face = { anchor: txt, size: rd, flat: true, movable: true, docs: true, scale: [0.45, 1.6], setScale: (s) => docs.scale.setScalar(s) };
  return H.finish(root, ctx, { radius: Math.max(w, d) * 0.7, height: 0.02, update, anchors: { text: txt, paper: txt, center: txt, headline: head, top: head }, face });
}
const anchor0 = (p, n, x, y, z) => { const a = new THREE.Object3D(); a.name = 'anchor_' + n; a.position.set(x, y, z); p.add(a); return a; };

export const DOCS = {
  wireless_form, build,
  CATALOG: {
    'detail.papers': { section: 'objects', desc: "INSERT: documents lying on a desk with a pencil and a second sheet: content ship_plan = a linen (or blueprint) side elevation of a liner with N watertight bulkheads, the first K compartments from the bow washed blue as flooded (flood [t0, t1] fills them as we watch), the ship's name and a title block; letter = a handwritten letter (ink, date, body, signature, optional letterhead; write [t0, t1] writes it); telegram = typed strips pasted on a TELEGRAM form; newspaper = a front page (masthead, date line, a 1-3 line headline, subhead, six columns, a halftone photo of a liner); map = a period chart (graticule, coast, soundings, compass rose) with a dashed route to a circled X, label and position (draw [t0, t1] draws the route)", params: { content: 'ship_plan | letter | telegram | newspaper | map', name: "ship_plan: ship name ('R.M.S. TITANIC')", compartments: 'ship_plan: n (16)', flooded: 'ship_plan: K from the bow | [indices from the bow]', flood: '[t0, t1] s', funnels: 'ship_plan: 1-4', style: 'ship_plan: linen | blueprint', flood_label: 'ship_plan caption', text: 'letter / telegram body (| = new line)', date: 'string', signature: 'string', salutation: 'letter', header: 'letterhead / form title', write: '[t0, t1] s (letter)', from: 'telegram', to: 'telegram', masthead: "newspaper ('The Evening Chronicle')", headline: 'newspaper', subhead: 'newspaper (| = new line)', edition: "'EXTRA'", price: "'ONE CENT'", caption: 'photo caption', label: "map: mark label ('TITANIC SANK HERE')", position: "map: '41° 46′ N 50° 14′ W'", route: 'map: [[lonW, latN], ...]', mark: 'map: [lonW, latN]', lon: '[west, east] (60, 38)', lat: '[south, north] (36, 50)', draw: '[t0, t1] s (map)', coast: 'map coast name', title: 'map / plan title', turn: 'deg the sheet is turned on the desk', extras: 'false = the sheet alone', age: '0..1', surface: 'desk | table | wood | none', backdrop: 'dark | none', light: 'warm | cool | top | none', place_on: "'structures:N.desk'", offset: '[dx, dz]', heading: 'deg: the reader side' }, actions: ['write', 'flood', 'draw'], anchors: ['text', 'headline'], footprint: [0.9, 0.6], height: 0.02, tags: ['detail', 'insert', 'papers', 'document', 'letter', 'telegram', 'newspaper', 'headline', 'map', 'chart', 'plan', 'blueprint', 'compartments'] },
  },
};
