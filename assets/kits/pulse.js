/* pulse.js — the PULSE kit: the weekly AI briefing.
   Two grounds, switched hard: near-black #0D0D0D for anything about a model, paper white for anything
   being reasoned about. Type is Inter across the whole weight range — hairline for the big statements,
   heavy for the numbers — with a mono for anything that is meant to read as an interface, and one
   italic serif word per title as the only ornament in the system.
   Accents: orange #FF6D24 marks the subject of a comparison, pink #E58CA3 marks a phrase inside a line,
   lime #BEF242 belongs to the interface furniture (chapter counter, window border) and nothing else.
   Fonts: Kit Sans (Inter var 100-900), Kit Mono (Space Mono), Kit Serif (EB Garamond Italic). */

const CSS = `
.sans{font-family:'Kit Sans',Inter,Helvetica,Arial,sans-serif;font-variation-settings:'opsz' 32}
.mono{font-family:'Kit Mono','SF Mono',Menlo,monospace}
.ser{font-family:'Kit Serif',Georgia,serif;font-style:italic}
.tnum{font-variant-numeric:tabular-nums;font-feature-settings:'tnum' 1}
.cur{opacity:.85}
.pill{display:inline-block;background:#000;color:#fff;padding:.02em .22em;border-radius:3px}
.pillw{display:inline-block;background:#fff;color:#000;padding:.02em .22em;border-radius:3px}
`;

const BLACK = P.black || '#0D0D0D', INK = P.ink || '#FFFFFF', PAPER = P.paper || '#FFFFFF';
const OR = P.orange || '#FF6D24', PINK = P.pink || '#E58CA3', LIME = P.lime || '#BEF242';
const BAR = P.bar || '#47474B', DIM = P.dim || '#8A8A8E';

/* ── grounds ──────────────────────────────────────────────────────────────── */
function dark(g) {
  ground.style.backgroundImage = 'none';
  ground.style.background = g || BLACK;
  vig.style.background = 'radial-gradient(ellipse at 50% 45%,rgba(0,0,0,0) 40%,rgba(0,0,0,.55) 100%)';
  grain(0.055);
}
function paper() {
  ground.style.backgroundImage = 'none';
  ground.style.background = PAPER;
  // the faint engineering grid the reference draws its annotations on
  ground.style.backgroundImage =
    'linear-gradient(rgba(0,0,0,.045) 1px,transparent 1px),linear-gradient(90deg,rgba(0,0,0,.045) 1px,transparent 1px)';
  ground.style.backgroundSize = '64px 64px';
  vig.style.background = 'radial-gradient(ellipse at 50% 50%,rgba(0,0,0,0) 60%,rgba(0,0,0,.07) 100%)';
  grain(0.03);
}

/* ── shared motion ────────────────────────────────────────────────────────── */
// a big word arrives: blurred, a touch too big, then settles. The overshoot is what
// makes it read as After Effects rather than a slide appearing.
function arrive(el, p, opt) {
  const o = opt || {}, dy = o.dy == null ? 26 : o.dy, sc = o.scale == null ? 1.05 : o.scale;
  const e = eo5(clamp(p));
  el.style.opacity = clamp(p * 1.9);
  el.style.filter = p >= 1 ? 'none' : `blur(${(1 - e) * 14}px)`;
  el.style.transform = `translate3d(0,${(1 - e) * dy}px,0) scale(${lerp(sc, 1, eback(clamp(p)))})`;
}
// a counter that lands exactly on its number: eased, never linear, so it decelerates like a dial
function count(to, p, dec) { return fmt(Number(to) * eo3(clamp(p)), dec || 0); }
function px(n) { return n + 'px'; }
// smoothstep: peak speed 1.5x the average. The page's eio3 peaks at 3x, which reads as a jump.
const ss = x => { x = clamp(x); return x * x * (3 - 2 * x); };

/* ── the board: a notebook page the camera moves across ───────────────────── */
// All of it measured off a reference recording frame by frame (2074x1168 -> 1920x1080,
// x0.926): grid cell 208px, body type 112px, the chip 1.76x the type with two corner
// marks, the money bag drawn rather than set as an emoji (an emoji font renders it in
// colour, at the wrong weight, and off the baseline).
const BRD = { g: 208, dot: { x: 605, y: 906, r: 26 }, l1x: 740, l1y: 939, callw: 418, callh: 216 };
function boardGrid(c, cam) {
  const g = BRD.g;
  c.fillStyle = PAPER; c.fillRect(0, 0, W, H);
  c.strokeStyle = 'rgba(0,0,0,.035)'; c.lineWidth = 2;
  const ox = -(((cam.x - (BRD.dot.x - g / 2)) % g) + g) % g, oy = -(((cam.y - (BRD.dot.y - g / 2)) % g) + g) % g;
  for (let x = ox; x < W + g; x += g) { c.beginPath(); c.moveTo(x + .5, 0); c.lineTo(x + .5, H); c.stroke(); }
  for (let y = oy; y < H + g; y += g) { c.beginPath(); c.moveTo(0, y + .5); c.lineTo(W, y + .5); c.stroke(); }
}
// the bag: black outline body with round shoulders and small feet, grey tie and grey dollar
function bagGlyph(c, x, base, h, fam) {
  const w = h * .84, lw = h * .085, top = base - h, nt = top + h * .25, nb = top + h * .33;
  c.save(); c.lineJoin = 'round'; c.lineCap = 'round';
  c.strokeStyle = DIM; c.lineWidth = lw * .95;
  c.beginPath();
  c.moveTo(x - w * .23, nt);
  c.bezierCurveTo(x - w * .40, top - h * .03, x - w * .12, top - h * .02, x, top + h * .15);
  c.bezierCurveTo(x + w * .12, top - h * .02, x + w * .40, top - h * .03, x + w * .23, nt);
  c.stroke();
  c.strokeStyle = '#000'; c.lineWidth = lw;
  c.beginPath(); c.moveTo(x - w * .26, nt + lw * .4); c.lineTo(x + w * .26, nt + lw * .4); c.stroke();
  c.beginPath();
  c.moveTo(x - w * .21, nb);
  c.bezierCurveTo(x - w * .38, base - h * .50, x - w * .46, base - h * .34, x - w * .43, base - h * .15);
  c.quadraticCurveTo(x - w * .42, base - h * .04, x - w * .50, base);
  c.lineTo(x + w * .50, base);
  c.quadraticCurveTo(x + w * .42, base - h * .04, x + w * .43, base - h * .15);
  c.bezierCurveTo(x + w * .46, base - h * .34, x + w * .38, base - h * .50, x + w * .21, nb);
  c.closePath(); c.stroke();
  c.fillStyle = DIM; c.font = `700 ${Math.round(h * .46)}px ${fam}`;
  c.textAlign = 'center'; c.fillText('$', x, base - h * .19); c.textAlign = 'left';
  c.restore();
}
// one line of the argument; a $ in the text is replaced by the bag
function boardLine(c, text, x, base, fs, fam) {
  const i = text.indexOf('$');
  c.font = `400 ${fs}px ${fam}`; c.textBaseline = 'alphabetic'; c.fillStyle = '#000';
  if (i < 0) { c.fillText(text, x, base); return; }
  const a = text.slice(0, i), b = text.slice(i + 1);
  c.fillText(a, x, base);
  let cx = x + c.measureText(a).width;
  bagGlyph(c, cx + fs * .31, base + fs * .02, fs * .72, fam);
  c.fillStyle = '#000'; c.fillText(b, cx + fs * .62, base);
}

/* ── build ────────────────────────────────────────────────────────────────── */
function build() {
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  const t = S.type;

  /* NAMECARD — the person behind the story: a real photo, their name set so large
     it runs off the frame, the role underneath. The crop is the point: a name that
     fits looks like a caption, a name that does not looks like a title sequence. */
  if (t === 'namecard') {
    dark();
    const photo = S.photo || S.ground || '';
    scene.innerHTML = `
      <div id="ph" style="position:absolute;right:0;top:0;width:1150px;height:1080px;overflow:hidden">
        <div id="phi" style="position:absolute;inset:-40px;background:url('${photo}') center/cover no-repeat"></div>
        <div style="position:absolute;inset:0;background:linear-gradient(90deg,${BLACK} 0%,rgba(13,13,13,.55) 22%,rgba(13,13,13,0) 55%)"></div>
      </div>
      <div id="nm" class="sans" style="position:absolute;left:-30px;top:392px;width:1400px;font-weight:800;font-size:196px;
           line-height:.86;letter-spacing:-.04em;color:${S.accent || PINK};white-space:nowrap"></div>
      <div id="rl" class="sans" style="position:absolute;left:8px;top:268px;font-size:34px;font-weight:500;
           letter-spacing:.02em;color:${INK};opacity:0;line-height:1.3"></div>`;
    const nm = document.getElementById('nm');
    const words = String(S.name || '').trim().split(/\s+/);
    nm.innerHTML = words.map(w => `<span class="mask" style="display:block"><span class="line" style="display:block">${esc(w)}</span></span>`).join('');
    const rl = document.getElementById('rl');
    rl.innerHTML = String(S.role || '').split('\n').map(l => esc(l)).join('<br>');
    parts = { ph: document.getElementById('phi'), rows: [...nm.querySelectorAll('.line')], rl };
  }

  /* SNAP — the shutter. A real photo of the person fills the frame; on the beat their
     CUTOUT burns to pure white for two frames and falls back into the picture, the shot
     pushes right, and the company's mark rises in on the black it leaves behind.

     Measured off the reference recording (2074x1010 -> 1920x1080): the flash is not a
     full-frame wash — the background stays black and only the subject goes white, mean
     luma over the silhouette 243 of 255 against 111 normally. It is full for about two
     frames at 120 fps, then falls to nothing over 370 ms on a squared curve. That shape
     is the whole effect: a flat fade reads as a dissolve, the instant-on-slow-off reads
     as a camera. */
  if (t === 'snap') {
    dark();
    const photo = S.photo || S.ground || '';
    const cut = S.cut || '';
    scene.innerHTML = `
      <div id="shot" style="position:absolute;inset:0;will-change:transform">
        <!-- height-fit, not cover: a 3:4 portrait stands in the middle on black the way the
             reference's speaker does, instead of being blown up until his forehead leaves
             the frame; a 16:9 still fills the frame exactly as before. The cutout sits on
             the same geometry so the white burn lands on the person to the pixel. -->
        <img src="${photo}" style="position:absolute;left:50%;top:0;height:100%;width:auto;
             transform:translateX(-50%);max-width:none">
        ${cut ? `<img id="burn" src="${cut}" style="position:absolute;left:50%;top:0;height:100%;width:auto;
             transform:translateX(-50%);max-width:none;opacity:0;filter:brightness(0) invert(1);will-change:opacity">` : ''}
      </div>
      <div id="fade" style="position:absolute;inset:0;opacity:0;
           background:linear-gradient(90deg,${BLACK} 0%,${BLACK} 30%,rgba(13,13,13,.86) 44%,rgba(13,13,13,0) 66%)"></div>
      <div id="mark" style="position:absolute;left:118px;top:180px;width:620px;height:172px;opacity:0">
        ${S.logo ? `<img src="${S.logo}" style="width:100%;height:100%;object-fit:contain;object-position:left center">`
                 : `<div class="sans" style="font-size:112px;font-weight:800;letter-spacing:-.03em;color:${INK};
                      white-space:nowrap;line-height:172px">${esc(S.name || '')}</div>`}
      </div>
      <div id="sub" class="sans" style="position:absolute;left:120px;top:404px;width:660px;font-size:40px;
           font-weight:500;letter-spacing:.005em;color:${DIM};line-height:1.32"></div>`;
    const sub = document.getElementById('sub');
    sub.innerHTML = String(S.line || '').split('').map(c =>
      `<span class="ch" style="opacity:0">${c === ' ' ? '&nbsp;' : esc(c)}</span>`).join('');
    parts = { shot: document.getElementById('shot'), burn: document.getElementById('burn'),
              fade: document.getElementById('fade'), mark: document.getElementById('mark'),
              chars: [...sub.querySelectorAll('.ch')] };
  }

  /* TALLY — a figure rung up on drums. Every digit is its own drum, spinning hard and
     blurred, and they land one after another from the left like a register settling;
     the camera starts so close that one spinning digit fills the frame and pulls back
     until the whole figure and its caption sit in shot. The technique — three faces
     on a cylinder that flatten as they turn away, a blur only along the direction of
     travel, a clunk through the frame as each drum stops — comes from the ALMANAC
     tally; the look is PULSE's own: white on near-black, the subject line in orange,
     the tag in lime as interface furniture. */
  if (t === 'tally') {
    dark();
    const txt = String(S.text || '') || ((S.prefix || '') + fmt(Number(S.value || 0), S.decimals || 0) + (S.suffix || ''));
    const F = txt.length > 7 ? 230 : txt.length > 5 ? 280 : 330;
    scene.innerHTML = `
      <div id="tw" style="position:absolute;left:0;top:0;width:1920px;height:1080px;will-change:transform">
        <div id="fig" class="sans tnum" style="position:absolute;left:0;top:${Math.round(470 - F * .55)}px;width:1920px;height:${Math.round(F * 1.1)}px"></div>
        <div id="ul" style="position:absolute;height:6px;top:${Math.round(470 + F * .62)}px;background:${OR};transform-origin:0 50%;transform:scaleX(0)"></div>
      </div>
      <div id="tag" class="mono" style="position:absolute;left:96px;top:92px;font-size:24px;letter-spacing:.14em;color:${LIME};opacity:0">${esc(S.tag || '')}</div>
      <div id="cap" class="sans" style="position:absolute;left:0;width:1920px;text-align:center;top:${Math.round(470 + F * .62) + 48}px;
           font-size:40px;font-weight:400;color:${DIM};opacity:0">${esc(S.caption || '')}</div>`;
    const fig = document.getElementById('fig');
    // measure: every digit sits in a tabular slot of the same width
    const probe = document.createElement('span'); probe.className = 'sans tnum';
    probe.style.cssText = `position:absolute;visibility:hidden;font-weight:800;font-size:${F}px;letter-spacing:-.03em;white-space:pre`;
    fig.appendChild(probe);
    const wOf = c => { probe.textContent = c; return probe.getBoundingClientRect().width; };
    const dw = wOf('0'), chars = [...txt], widths = chars.map(c => /\d/.test(c) ? dw : wOf(c));
    const total = widths.reduce((a, b) => a + b, 0);
    let x = (1920 - total) / 2;
    const drums = [];
    chars.forEach((c, i) => {
      const box = document.createElement('div');
      box.style.cssText = `position:absolute;left:${x.toFixed(1)}px;top:0;width:${widths[i].toFixed(1)}px;height:${Math.round(F * 1.1)}px;overflow:hidden`;
      if (/\d/.test(c)) {
        const id = 'pb' + i;
        box.innerHTML = `<svg width="0" height="0" style="position:absolute"><defs><filter id="${id}" x="-5%" y="-40%" width="110%" height="180%">
          <feGaussianBlur stdDeviation="0 0"/></filter></defs></svg><div class="strip" style="position:absolute;inset:0"></div>`;
        const strip = box.querySelector('.strip'), faces = [];
        for (let k = 0; k < 3; k++) {
          const f = document.createElement('div');
          f.style.cssText = `position:absolute;left:0;top:0;width:100%;text-align:center;font-weight:800;font-size:${F}px;
            line-height:${F}px;letter-spacing:-.03em;color:${INK};will-change:transform`;
          strip.appendChild(f); faces.push(f);
        }
        drums.push({ strip, faces, blur: box.querySelector('feGaussianBlur'), id, digit: Number(c), n: drums.length });
      } else {
        box.innerHTML = `<div style="position:absolute;left:0;top:${Math.round(F * .05)}px;width:100%;text-align:center;font-weight:800;
          font-size:${F}px;line-height:${F}px;letter-spacing:-.03em;color:${INK}">${c === ' ' ? '&nbsp;' : esc(c)}</div>`;
      }
      fig.appendChild(box); x += widths[i];
    });
    probe.remove();
    const ul = document.getElementById('ul');
    ul.style.left = ((1920 - total) / 2).toFixed(1) + 'px'; ul.style.width = total.toFixed(1) + 'px';
    // where the camera starts: close on the LAST drum, the one still spinning longest
    const lastBox = fig.children[chars.length - 1];
    parts = { tw: document.getElementById('tw'), fig, drums, ul, F, winH: F * 1.1,
              tag: document.getElementById('tag'), cap: document.getElementById('cap'),
              focusX: lastBox ? lastBox.offsetLeft + lastBox.offsetWidth / 2 : 960 };
  }

  /* HAND — the week's cards. A deck lands and fans into a hand, one card per update:
     the company's mark, the model's name, the one figure that matters. Then the card
     the narration is about is pulled out and flown to the lens with a full turn in the
     air, while the rest of the hand sinks out of focus and the reason it matters rises
     beside it. Geometry after the ALMANAC hand (5:7 cards, the fan pivoting 860 px below
     each card, cards dealt 90 ms apart); the look is PULSE: dark cards, white type, the
     index in lime as interface furniture, and ORANGE only on the card that was pulled. */
  if (t === 'hand') {
    dark();
    const cards = (S.cards || []).slice(0, 5), n = cards.length;
    const hero = S.hero === -1 || S.hero === '-1' ? -1 : Math.min(n - 1, Math.max(0, S.hero == null ? n - 1 : Number(S.hero)));
    scene.innerHTML = `<div id="hd" style="position:absolute;inset:0;perspective:2400px"></div>
      <div id="ht" style="position:absolute;left:110px;top:430px;width:720px;opacity:0">
        <div id="htt" class="sans" style="font-size:78px;font-weight:800;letter-spacing:-.035em;line-height:1;color:${INK}">${esc(S.title || '')}</div>
        <div id="htx" class="sans" style="margin-top:22px;font-size:34px;font-weight:400;line-height:1.35;color:${DIM}">${esc(S.text || '')}</div>
      </div>`;
    const host = document.getElementById('hd'), els = [];
    cards.forEach((c, i) => {
      const el = document.createElement('div');
      el.style.cssText = `position:absolute;left:${960 - 220}px;top:${640 - 308}px;width:440px;height:616px;border-radius:22px;
        background:#151515;box-shadow:0 30px 80px rgba(0,0,0,.6),inset 0 0 0 1px rgba(255,255,255,.12);overflow:hidden;
        transform-origin:50% ${308 + 860}px;will-change:transform,filter,opacity;backface-visibility:hidden`;
      const nm = String(c.name || '');
      el.innerHTML = `
        <div class="mono" style="position:absolute;right:26px;top:24px;font-size:20px;letter-spacing:.12em;color:${LIME}">${String(i + 1).padStart(2, '0')}/${String(n).padStart(2, '0')}</div>
        <div style="position:absolute;left:32px;top:30px;height:44px;width:250px">
          ${c.logo ? `<img src="${c.logo}" style="height:100%;max-width:100%;object-fit:contain;object-position:left center">`
                   : `<div class="sans" style="font-size:26px;font-weight:700;color:${INK};line-height:44px">${esc(c.tag || '')}</div>`}</div>
        <div class="sans" style="position:absolute;left:32px;right:32px;top:196px;font-size:${nm.length > 14 ? 58 : 70}px;font-weight:800;
             letter-spacing:-.035em;line-height:.98;color:${INK}">${esc(nm)}</div>
        <div class="strip" style="position:absolute;left:0;right:0;top:420px;height:6px;background:${OR};transform:scaleX(0);transform-origin:0 50%"></div>
        <div class="mono" style="position:absolute;left:32px;right:32px;top:452px;font-size:28px;letter-spacing:.02em;line-height:1.3;color:${DIM}">${esc(c.line || '')}</div>
        <div class="sans" style="position:absolute;left:32px;bottom:30px;font-size:20px;letter-spacing:.14em;color:#6f6f73;text-transform:uppercase">${esc(c.tag || '')}</div>`;
      host.appendChild(el); els.push(el);
    });
    const step = n > 1 ? Math.min(20, 44 / (n - 1)) : 0;
    parts = { els, n, hero, step, ht: document.getElementById('ht'),
              pullAt: Number(S.pull_at) || Math.min(Math.max(D - 3.6, 2.2), 2.9) };
  }

  /* RACE — two models, one task, and the cut before the finish. Two terminals side by
     side type the same prompt, then both stream code, token counters running and a
     progress bar filling under each — and a frame before either bar reaches the end,
     everything freezes and a chip drops: who finishes is at the end of the video.
     It is a promise, not a result: both runs move at the SAME pace, jittered only so
     they are not identical, because nothing on screen may claim a winner nobody has
     seen yet. The code is illustrative — the chip and the prompt say what is real. */
  if (t === 'race') {
    dark();
    const A = S.a || 'Model A', B = S.b || 'Model B';
    const pane = (id, x, name) => `
      <div id="${id}" style="position:absolute;left:${x}px;top:170px;width:820px;height:650px;border-radius:18px;background:#111113;
           box-shadow:0 30px 90px rgba(0,0,0,.6),inset 0 0 0 1px rgba(255,255,255,.12);overflow:hidden;opacity:0">
        <div style="position:absolute;left:0;right:0;top:0;height:64px;border-bottom:1px solid rgba(255,255,255,.08);background:#161618"></div>
        <div style="position:absolute;left:24px;top:24px;width:12px;height:12px;border-radius:50%;background:#3a3a3e;box-shadow:20px 0 0 #3a3a3e,40px 0 0 #3a3a3e"></div>
        <div class="sans" style="position:absolute;left:96px;top:15px;font-size:28px;font-weight:700;color:${INK};letter-spacing:-.01em">${esc(name)}</div>
        <div class="mono tok" style="position:absolute;right:24px;top:21px;font-size:21px;color:${LIME};letter-spacing:.06em">0 tok</div>
        <div class="mono prm" style="position:absolute;left:28px;right:28px;top:88px;font-size:22px;color:${INK};line-height:1.35"></div>
        <div class="mono code" style="position:absolute;left:28px;right:28px;top:150px;bottom:74px;font-size:19px;line-height:1.5;color:#a6a6ad;overflow:hidden;white-space:pre"></div>
        <div style="position:absolute;left:28px;right:28px;bottom:32px;height:8px;border-radius:4px;background:rgba(255,255,255,.08)"></div>
        <div class="bar" style="position:absolute;left:28px;bottom:32px;height:8px;width:764px;border-radius:4px;background:${INK};transform-origin:0 50%;transform:scaleX(0)"></div>
      </div>`;
    scene.innerHTML = pane('pa', 120, A) + pane('pb', 980, B) + `
      <div id="rt" class="mono" style="position:absolute;left:0;width:1920px;top:96px;text-align:center;font-size:22px;letter-spacing:.2em;color:${DIM};opacity:0">${esc((S.task_label || 'SAME TASK · SAME PROMPT').toUpperCase())}</div>
      <div id="chip" style="position:absolute;left:50%;top:470px;transform:translate(-50%,-50%) scale(.6);opacity:0;padding:22px 40px;border-radius:10px;background:#000;
           box-shadow:0 0 0 1px rgba(255,255,255,.18),0 30px 80px rgba(0,0,0,.8);white-space:nowrap">
        <div class="sans" style="font-size:64px;font-weight:800;letter-spacing:-.03em;color:${INK};line-height:1">${esc(S.chip || 'Who finishes?')}</div>
        <div class="mono" style="margin-top:12px;font-size:22px;letter-spacing:.16em;color:${OR};text-align:center">${esc((S.chip_sub || 'at the end of the video').toUpperCase())}</div>
      </div>`;
    // what streams in both panes: a real, readable snake game — a developer who pauses
    // the video should read code, not word salad. The panes start a few lines apart so
    // they are clearly two runs, not one run shown twice.
    const code = `const canvas = document.querySelector('canvas');
const ctx = canvas.getContext('2d');
const SIZE = 20, CELLS = 24;
let snake = [{ x: 12, y: 12 }];
let dir = { x: 1, y: 0 };
let food = spawnFood();
let score = 0;

function spawnFood() {
  while (true) {
    const f = { x: rand(CELLS), y: rand(CELLS) };
    if (!snake.some(s => s.x === f.x && s.y === f.y)) return f;
  }
}

function rand(n) { return Math.floor(Math.random() * n); }

document.addEventListener('keydown', e => {
  const k = { ArrowUp: [0, -1], ArrowDown: [0, 1],
              ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[e.key];
  if (k && (k[0] !== -dir.x || k[1] !== -dir.y)) dir = { x: k[0], y: k[1] };
});

function tick() {
  const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
  const out = head.x < 0 || head.y < 0 || head.x >= CELLS || head.y >= CELLS;
  if (out || snake.some(s => s.x === head.x && s.y === head.y)) return reset();
  snake.unshift(head);
  if (head.x === food.x && head.y === food.y) { score++; food = spawnFood(); }
  else snake.pop();
  draw();
}

function draw() {
  ctx.fillStyle = '#0d0d0d';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#ff6d24';
  ctx.fillRect(food.x * SIZE, food.y * SIZE, SIZE - 2, SIZE - 2);
  ctx.fillStyle = '#ffffff';
  for (const s of snake) ctx.fillRect(s.x * SIZE, s.y * SIZE, SIZE - 2, SIZE - 2);
  document.title = 'score ' + score;
}

function reset() { snake = [{ x: 12, y: 12 }]; dir = { x: 1, y: 0 }; score = 0; }

setInterval(tick, 90);`.split('\n');
    const els = ['pa', 'pb'].map(id => {
      const root = document.getElementById(id);
      return { root, tok: root.querySelector('.tok'), prm: root.querySelector('.prm'),
               code: root.querySelector('.code'), bar: root.querySelector('.bar') };
    });
    parts = { els, code, prompt: '> ' + String(S.task || 'build a playable snake game in one HTML file'),
              rt: document.getElementById('rt'), chip: document.getElementById('chip') };
  }

  /* CHAT — a model answering, on screen. A chat window on a desktop wallpaper: the
     prompt types into the box, is sent, and the answer streams in word by word with the
     cursor at its end, the window scrolling as it grows. The ANSWER IS THE MODEL'S OWN:
     kits.generate runs the prompt on the named model and hands its reply to this scene;
     a model the pipeline cannot reach gets no chat scene at all, never a written one.
     The wallpaper is drawn here (soft blobs of colour under grain), so it costs nothing
     and never looks like a stock desktop. */
  if (t === 'chat') {
    const seed = (S.seed || 7) * 9301 % 233280;
    const r = k => ((seed * (k + 1) * 49297) % 233280) / 233280;
    // the colour lives at the EDGES, where the window does not cover it — first drawn under
    // the window, the wallpaper was invisible and the frame read as a black screen
    const blobs = [['#4b33c9', .04, .08], ['#d63a78', .97, .14], ['#ff6d24', .88, 1.02], ['#2f7fe0', .06, .96], ['#8a3fd1', .5, 1.08]]
      .map(([c, x, y], i) => `radial-gradient(${760 + r(i) * 320}px ${620 + r(i + 4) * 260}px at ${(x + (r(i + 8) - .5) * .08) * 100}% ${(y + (r(i + 12) - .5) * .08) * 100}%, ${c}f0, transparent 66%)`);
    // one shorthand, nothing after it: clearing backgroundImage here wiped the gradients
    ground.style.background = `${blobs.join(',')}, #0b0b12`;
    grain(0.06);
    vig.style.background = 'radial-gradient(ellipse at 50% 50%,rgba(0,0,0,0) 55%,rgba(0,0,0,.28) 100%)';
    const model = String(S.model || 'Assistant');
    scene.innerHTML = `
      <div id="cw" style="position:absolute;left:260px;top:120px;width:1400px;height:840px;border-radius:22px;overflow:hidden;
           background:rgba(20,20,24,.80);backdrop-filter:blur(30px);box-shadow:0 50px 140px rgba(0,0,0,.6),inset 0 0 0 1px rgba(255,255,255,.12);opacity:0">
        <div style="position:absolute;left:0;right:0;top:0;height:62px;background:rgba(255,255,255,.035);border-bottom:1px solid rgba(255,255,255,.07)"></div>
        <div style="position:absolute;left:26px;top:25px;width:12px;height:12px;border-radius:50%;background:#ff5f57;box-shadow:20px 0 0 #febc2e,40px 0 0 #28c840"></div>
        <div style="position:absolute;left:0;right:0;top:14px;text-align:center">
          ${S.logo ? `<img src="${S.logo}" style="height:22px;vertical-align:middle;margin-right:12px;opacity:.95">` : ''}
          <span class="sans" style="font-size:22px;font-weight:600;color:${INK};vertical-align:middle">${esc(model)}</span></div>
        <div id="cv" style="position:absolute;left:90px;right:90px;top:92px;bottom:150px;overflow:hidden">
          <div id="cs" style="position:absolute;left:0;right:0;top:0">
            <div id="ub" style="margin-left:auto;max-width:78%;width:fit-content;background:#2c2c32;border-radius:20px;padding:18px 24px;
                 font-size:32px;line-height:1.42;color:${INK};opacity:0" class="sans"></div>
            <div id="ab" class="sans" style="margin-top:36px;font-size:35px;line-height:1.5;color:#ececf0;white-space:pre-wrap"></div>
          </div>
        </div>
        <div style="position:absolute;left:90px;right:90px;bottom:40px;height:78px;border-radius:39px;background:#232328;
             box-shadow:inset 0 0 0 1px rgba(255,255,255,.1)">
          <div id="ib" class="sans" style="position:absolute;left:30px;right:100px;top:22px;font-size:26px;color:${INK};white-space:nowrap;overflow:hidden"></div>
          <div id="sb" style="position:absolute;right:14px;top:14px;width:50px;height:50px;border-radius:50%;background:#3a3a40"></div>
        </div>
      </div>`;
    const words = String(S.answer || '').split(/(\s+)/);
    parts = { cw: document.getElementById('cw'), cs: document.getElementById('cs'), cv: document.getElementById('cv'),
              ub: document.getElementById('ub'), ab: document.getElementById('ab'), ib: document.getElementById('ib'),
              sb: document.getElementById('sb'), prompt: String(S.prompt || ''), words };
  }

  /* PRICECUT — a price that just fell. The old price stands alone for a beat, an orange
     strike draws through it, it dims and drifts up out of the way, and the new price
     drops in from above and lands with a bounce; the saving counts up in a chip beside it.
     Orange is the cut: the strike and the chip, nothing else. */
  if (t === 'pricecut') {
    dark();
    const dec = Number(S.decimals || 0), pre = S.prefix || '', suf = S.suffix || '';
    const from = Number(S.from || 0), to = Number(S.to || 0);
    const pct = from ? Math.round((1 - to / from) * 100) : 0;
    scene.innerHTML = `
      <div id="pw" style="position:absolute;inset:0">
        <div id="old" class="sans tnum" style="position:absolute;left:0;width:1920px;top:300px;text-align:center;font-size:250px;font-weight:800;
             letter-spacing:-.04em;line-height:1;color:${INK}"><span id="ot">${esc(pre + fmt(from, dec) + suf)}</span></div>
        <div id="new" class="sans tnum" style="position:absolute;left:0;width:1920px;top:380px;text-align:center;font-size:330px;font-weight:800;
             letter-spacing:-.045em;line-height:1;color:${INK};opacity:0">${esc(pre + fmt(to, dec) + suf)}</div>
        <div id="chip" class="sans" style="position:absolute;left:0;top:0;padding:10px 26px;border-radius:40px;border:3px solid ${OR};
             font-size:58px;font-weight:800;color:${OR};opacity:0;white-space:nowrap"></div>
        <div id="pc" class="sans" style="position:absolute;left:0;width:1920px;top:770px;text-align:center;font-size:40px;color:${DIM};opacity:0">${esc(S.caption || '')}</div>
        <div id="ptag" class="mono" style="position:absolute;left:96px;top:92px;font-size:24px;letter-spacing:.14em;color:${LIME};opacity:0">${esc(S.tag || '')}</div>
      </div>`;
    const ot = document.getElementById('ot'), oldEl = document.getElementById('old');
    ot.style.position = 'relative'; ot.style.display = 'inline-block';
    const strike = document.createElement('div');
    strike.style.cssText = `position:absolute;left:-20px;right:-20px;top:52%;height:14px;border-radius:7px;background:${OR};
      transform-origin:0 50%;transform:rotate(-12deg) scaleX(0)`;
    ot.appendChild(strike);
    oldEl.style.transformOrigin = '50% 50%';
    const r = ot.getBoundingClientRect();
    parts = { old: document.getElementById('old'), nw: document.getElementById('new'), chip: document.getElementById('chip'),
              pc: document.getElementById('pc'), tag: document.getElementById('ptag'), strike, pct, oldBox: r };
  }

  /* BREAKOUT — how a model got out. A clean diagram, not a hacker: the test sandbox as a
     dashed box with the model inside, the companies' servers outside to the right, still
     and dark. A line leaves the model, finds the gap in the box — the misconfiguration —
     runs out to the open internet and branches to each server, which lights orange as it
     is reached. Everything is drawn as it happens, nothing is decoration. */
  if (t === 'breakout') {
    dark();
    const outer = (S.outer || ['Company A', 'Company B', 'Company C']).slice(0, 4);
    const n = outer.length;
    const ys = outer.map((_, i) => 540 + (i - (n - 1) / 2) * 190);
    scene.innerHTML = `
      <svg id="bs" width="1920" height="1080" style="position:absolute;left:0;top:0;overflow:visible">
        <defs><filter id="bglow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6"/></filter></defs>
        <rect id="box" x="200" y="300" width="560" height="480" rx="26" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="3" stroke-dasharray="14 12"/>
        <rect id="gap" x="744" y="500" width="32" height="80" fill="#0D0D0D"/>
        <circle id="net" cx="1080" cy="540" r="10" fill="${INK}" opacity="0"/>
        <path id="p0" d="M 540 540 L 760 540 L 1080 540" fill="none" stroke="${OR}" stroke-width="5" stroke-linecap="round"/>
        ${ys.map((y, i) => `<path id="b${i}" d="M 1080 540 C 1220 540, 1260 ${y}, 1400 ${y}" fill="none" stroke="${OR}" stroke-width="4" stroke-linecap="round"/>`).join('')}
      </svg>
      <div id="bl" class="mono" style="position:absolute;left:200px;top:246px;font-size:22px;letter-spacing:.16em;color:${DIM};opacity:0">${esc((S.box || 'TEST SANDBOX').toUpperCase())}</div>
      <div id="core" style="position:absolute;left:360px;top:460px;width:250px;height:160px;border-radius:20px;background:#1a1a1d;
           box-shadow:inset 0 0 0 1px rgba(255,255,255,.18);display:flex;align-items:center;justify-content:center;opacity:0">
        ${S.logo ? `<img src="${S.logo}" style="max-width:200px;max-height:84px;object-fit:contain">` : `<span class="sans" style="font-size:34px;font-weight:800;color:${INK}">${esc(S.inner || 'MODEL')}</span>`}</div>
      <div id="gl" class="mono" style="position:absolute;left:700px;top:600px;font-size:20px;letter-spacing:.12em;color:${OR};opacity:0;white-space:nowrap">${esc((S.gap || 'internet left open').toUpperCase())}</div>
      <div id="nl" class="mono" style="position:absolute;left:1030px;top:470px;font-size:20px;letter-spacing:.14em;color:${DIM};opacity:0">${esc((S.net || 'LIVE INTERNET').toUpperCase())}</div>
      ${outer.map((o, i) => `<div class="srv" style="position:absolute;left:1400px;top:${ys[i] - 60}px;width:330px;height:120px;border-radius:16px;background:#141416;
           box-shadow:inset 0 0 0 1px rgba(255,255,255,.12);opacity:0">
           <div style="position:absolute;left:22px;top:22px;width:10px;height:76px;border-radius:5px;background:#2a2a2e" class="led"></div>
           <div class="sans" style="position:absolute;left:54px;top:26px;font-size:34px;font-weight:700;color:${INK}">${esc(o)}</div>
           <div class="mono" style="position:absolute;left:54px;top:74px;font-size:18px;letter-spacing:.12em;color:${DIM}">SYSTEMS</div></div>`).join('')}`;
    const len = el => el.getTotalLength();
    const p0 = document.getElementById('p0'), bs = ys.map((_, i) => document.getElementById('b' + i));
    [p0, ...bs].forEach(pth => { const L = len(pth); pth.style.strokeDasharray = L; pth.style.strokeDashoffset = L; pth.dataset.L = L; });
    parts = { p0, bs, srv: [...document.querySelectorAll('.srv')], leds: [...document.querySelectorAll('.srv .led')],
              core: document.getElementById('core'), bl: document.getElementById('bl'), gl: document.getElementById('gl'),
              nl: document.getElementById('nl'), net: document.getElementById('net'), box: document.getElementById('box'), n };
  }

  /* LEADERBOARD — a model climbing a real ranking. The rows are given in their FINAL
     order; the subject starts at rank `from` and slides up to its place while every row
     it passes steps down one to make room, its score counting from `old` to its own.
     The row lights orange only once it has arrived: the climb is the news, the colour
     is the verdict. Real standings only — the ranking is someone's published table. */
  if (t === 'leaderboard') {
    dark();
    const rows = (S.rows || []).slice(0, 7), n = rows.length;
    const hot = Math.max(0, Math.min(n - 1, Number(S.hot || 0)));
    const from = Math.max(hot + 1, Math.min(n, Number(S.from || n))) - 1;     // 0-based start
    const RH = 104, top0 = 270;
    scene.innerHTML = `
      <div class="sans" style="position:absolute;left:300px;top:150px;font-size:44px;font-weight:700;color:${INK};letter-spacing:-.02em">${esc(S.title || '')}</div>
      <div class="mono" style="position:absolute;right:300px;top:164px;font-size:22px;letter-spacing:.14em;color:${DIM}">${esc((S.sub || '').toUpperCase())}</div>
      <div id="lb" style="position:absolute;left:300px;top:${top0}px;width:1320px;height:${RH * n}px"></div>`;
    const lb = document.getElementById('lb');
    const els = rows.map((r, i) => {
      const el = document.createElement('div');
      el.style.cssText = `position:absolute;left:0;top:0;width:1320px;height:${RH - 14}px;border-radius:14px;background:#141416;
        box-shadow:inset 0 0 0 1px rgba(255,255,255,.08);will-change:transform`;
      el.innerHTML = `<div class="rk sans tnum" style="position:absolute;left:30px;top:22px;width:70px;font-size:40px;font-weight:800;color:${DIM}"></div>
        ${r.logo ? `<img src="${r.logo}" style="position:absolute;left:120px;top:26px;height:38px;max-width:170px;object-fit:contain;object-position:left center">` : ''}
        <div class="sans" style="position:absolute;left:320px;top:22px;font-size:40px;font-weight:700;color:${INK};letter-spacing:-.015em">${esc(r.name || '')}</div>
        <div class="sc sans tnum" style="position:absolute;right:34px;top:22px;font-size:40px;font-weight:700;color:${INK}"></div>`;
      lb.appendChild(el);
      return el;
    });
    parts = { els, rows, n, hot, from, RH, old: Number(S.old || 0) };
  }

  /* TIMELINE — how we got here. A line across the frame with the dates on it; the camera
     travels along it and each date pops as it comes into view, its label rising beside
     the dot; the last one — the news — lands in the middle of the frame, glows orange and
     pulses once. Dates are real dates; the spacing follows them, not the page. */
  if (t === 'timeline') {
    dark();
    const ev = (S.events || []).slice(0, 7), n = ev.length;
    const GAP = 520;
    const W0 = 960 - 0;
    scene.innerHTML = `${S.title ? `<div class="sans" style="position:absolute;left:120px;top:150px;font-size:64px;font-weight:800;letter-spacing:-.03em;color:${INK}">${esc(S.title)}</div>` : ''}
      ${S.sub ? `<div class="mono" style="position:absolute;left:124px;top:238px;font-size:22px;letter-spacing:.14em;color:${DIM}">${esc(String(S.sub).toUpperCase())}</div>` : ''}
      <div id="tl" style="position:absolute;left:0;top:0;width:${W0 + GAP * (n - 1) + 960}px;height:1080px;will-change:transform">
        <div id="ln" style="position:absolute;left:${W0 - 400}px;top:560px;height:4px;width:${GAP * (n - 1) + 800}px;background:rgba(255,255,255,.18);transform-origin:0 50%"></div>
        ${ev.map((e, i) => `<div class="tdot" style="position:absolute;left:${W0 + i * GAP - 14}px;top:548px;width:28px;height:28px;border-radius:50%;
            background:${i === n - 1 ? OR : INK};transform:scale(0)"></div>
          ${i === n - 1 ? `<div class="tring" style="position:absolute;left:${W0 + i * GAP - 14}px;top:548px;width:28px;height:28px;border-radius:50%;
            box-shadow:0 0 0 3px ${OR};opacity:0"></div>` : ''}
          <div class="tdate mono" style="position:absolute;left:${W0 + i * GAP - 200}px;width:400px;text-align:center;top:470px;font-size:26px;letter-spacing:.14em;
            color:${i === n - 1 ? OR : DIM};opacity:0">${esc(String(e.date || '').toUpperCase())}</div>
          <div class="tlab sans" style="position:absolute;left:${W0 + i * GAP - 230}px;width:460px;text-align:center;top:612px;font-size:${i === n - 1 ? 46 : 36}px;
            font-weight:${i === n - 1 ? 800 : 600};line-height:1.15;color:${INK};opacity:0">${esc(e.label || '')}</div>`).join('')}
      </div>`;
    parts = { tl: document.getElementById('tl'), n, GAP,
              dots: [...document.querySelectorAll('.tdot')], dates: [...document.querySelectorAll('.tdate')],
              labs: [...document.querySelectorAll('.tlab')], ring: document.querySelector('.tring') };
  }

  /* FLIP — the turn into the next update. A split-flap counter, the kind a station board
     has: the old number's top flap falls, the new one's bottom flap lands, and the counter
     reads 05 / 12. Then the update it opens rises beside it — the company's mark and the
     model's name — and a line runs out under both. Lime, because the counter is interface
     furniture; the name is white, the only accent is where the scene came from. */
  if (t === 'flip') {
    dark();
    const n = Math.max(1, Number(S.n || 1)), of = Math.max(n, Number(S.of || 12));
    const prev = String(Math.max(0, n - 1)).padStart(2, '0'), cur = String(n).padStart(2, '0');
    const FW = 190, FH = 280, GAPX = 16, X0 = 250, Y0 = 400;
    const face = (ch, half, id) => `<div ${id ? `id="${id}"` : ''} style="position:absolute;left:0;top:${half === 'b' ? FH / 2 : 0}px;width:${FW}px;height:${FH / 2}px;overflow:hidden;
        background:#18181b;border-radius:${half === 't' ? '16px 16px 0 0' : '0 0 16px 16px'};transform-origin:50% ${half === 't' ? '100%' : '0'};backface-visibility:hidden">
        <div class="mono" style="position:absolute;left:0;width:${FW}px;top:${half === 'b' ? -FH / 2 : 0}px;height:${FH}px;line-height:${FH}px;text-align:center;
             font-size:230px;font-weight:700;color:${LIME}">${ch}</div></div>`;
    let html = '';
    for (let k = 0; k < 2; k++) {
      const x = X0 + k * (FW + GAPX);
      html += `<div class="fl" style="position:absolute;left:${x}px;top:${Y0}px;width:${FW}px;height:${FH}px;perspective:900px">
        ${face(cur[k], 't')}${face(prev[k], 'b')}
        ${face(prev[k], 't', 'ft' + k)}${face(cur[k], 'b', 'fb' + k)}
        <div style="position:absolute;left:0;top:${FH / 2 - 1}px;width:${FW}px;height:3px;background:#0D0D0D"></div></div>`;
    }
    scene.innerHTML = html + `
      <div id="fo" class="mono" style="position:absolute;left:${X0 + 2 * (FW + GAPX) + 18}px;top:${Y0 + FH - 92}px;font-size:64px;color:${DIM};opacity:0">/${String(of).padStart(2, '0')}</div>
      <div id="fn" style="position:absolute;left:${X0 + 2 * (FW + GAPX) + 200}px;top:${Y0 + 26}px;width:780px;opacity:0">
        ${S.logo ? `<img src="${S.logo}" style="height:56px;max-width:420px;object-fit:contain;object-position:left center;display:block;margin-bottom:26px">` : ''}
        <div class="sans" style="font-size:96px;font-weight:800;letter-spacing:-.04em;line-height:1;color:${INK}">${esc(S.name || '')}</div>
        <div class="sans" style="margin-top:20px;font-size:36px;color:${DIM}">${esc(S.line || '')}</div></div>
      <div id="fr" style="position:absolute;left:${X0}px;top:${Y0 + FH + 60}px;height:4px;width:${2 * (FW + GAPX) + 980}px;background:rgba(255,255,255,.22);transform-origin:0 50%;transform:scaleX(0)"></div>`;
    parts = { ft: [0, 1].map(k => document.getElementById('ft' + k)), fb: [0, 1].map(k => document.getElementById('fb' + k)),
              fo: document.getElementById('fo'), fn: document.getElementById('fn'), fr: document.getElementById('fr'),
              changed: [prev[0] !== cur[0], prev[1] !== cur[1]] };
  }

  /* CONTEXT — how much a model can hold at once. A long window runs across the frame;
     pages fly in from the right and stack into it as a counter runs up to the model's
     context length, and the window fills to exactly its share. Reference marks along it
     (a book, a codebase) come only from the scene — no default comparisons are drawn,
     because "a novel is about 120K tokens" is a claim someone has to check. */
  if (t === 'context') {
    dark();
    const cap = Number(S.tokens || 1000000), marks = (S.marks || []).slice(0, 4);
    const BX = 180, BW = 1560, BY = 560, BH = 120;
    scene.innerHTML = `
      <div class="mono" style="position:absolute;left:${BX}px;top:${BY - 170}px;font-size:24px;letter-spacing:.16em;color:${LIME}">${esc((S.tag || 'CONTEXT WINDOW').toUpperCase())}</div>
      <div id="cn" class="sans tnum" style="position:absolute;left:${BX}px;top:${BY - 130}px;font-size:96px;font-weight:800;letter-spacing:-.04em;color:${INK}">0</div>
      <div class="sans" style="position:absolute;left:${BX + 2}px;top:${BY + BH + 36}px;font-size:36px;color:${DIM}">${esc(S.caption || '')}</div>
      <div style="position:absolute;left:${BX}px;top:${BY}px;width:${BW}px;height:${BH}px;border-radius:16px;background:#141416;box-shadow:inset 0 0 0 1px rgba(255,255,255,.14);overflow:hidden">
        <div id="cf" style="position:absolute;left:0;top:0;bottom:0;width:${BW}px;background:linear-gradient(90deg,rgba(255,255,255,.06),rgba(255,255,255,.16));transform-origin:0 50%;transform:scaleX(0)"></div>
        <div id="cpg" style="position:absolute;inset:0"></div>
      </div>
      ${marks.map(m => { const x = BX + BW * Math.min(1, Number(m.at || 0) / cap);
        return `<div class="cm" style="position:absolute;left:${x}px;top:${BY - 18}px;width:2px;height:${BH + 36}px;background:${PINK};opacity:0"></div>
          <div class="cml sans" style="position:absolute;left:${x + 10}px;top:${BY - 58}px;font-size:26px;font-weight:600;color:${PINK};opacity:0;white-space:nowrap">${esc(m.label || '')}</div>`; }).join('')}`;
    // the pages: small sheets with ruled lines, each flown into its place in the window
    const pg = document.getElementById('cpg'), N = 26, sheets = [];
    for (let i = 0; i < N; i++) {
      const el = document.createElement('div');
      el.style.cssText = `position:absolute;top:18px;width:62px;height:84px;border-radius:5px;background:#ececf0;opacity:0;
        background-image:repeating-linear-gradient(180deg,transparent 0 10px,rgba(0,0,0,.18) 10px 12px);background-size:44px 100%;background-position:9px 14px;background-repeat:no-repeat`;
      pg.appendChild(el); sheets.push(el);
    }
    parts = { cn: document.getElementById('cn'), cf: document.getElementById('cf'), sheets, N, BW, cap,
              cm: [...document.querySelectorAll('.cm')], cml: [...document.querySelectorAll('.cml')], marks };
  }

  /* QUOTE — someone's own words. Their photo stands on the right; the quote builds on the
     left a word at a time, and the phrase that matters turns pink as it is reached. Real
     words only, as said or printed — the scene sets them, it never rewrites them. */
  if (t === 'quote') {
    dark();
    const photo = S.photo || S.ground || '';
    scene.innerHTML = `
      ${photo ? `<div id="qp" style="position:absolute;right:0;top:0;width:900px;height:1080px;overflow:hidden">
        <img src="${photo}" style="position:absolute;left:50%;top:0;height:100%;width:auto;transform:translateX(-50%);max-width:none">
        <div style="position:absolute;inset:0;background:linear-gradient(90deg,${BLACK} 0%,rgba(13,13,13,.7) 25%,rgba(13,13,13,0) 60%)"></div></div>` : ''}
      <div class="sans" style="position:absolute;left:120px;top:190px;font-size:220px;font-weight:800;line-height:1;color:${PINK};opacity:.9">“</div>
      <div id="qt" class="sans" style="position:absolute;left:130px;top:360px;width:${photo ? 960 : 1560}px;font-size:${String(S.text || '').length > 110 ? 50 : String(S.text || '').length < 60 ? 80 : 62}px;
           font-weight:700;letter-spacing:-.02em;line-height:1.22;color:${INK}"></div>
      <div id="qw" style="position:absolute;left:132px;bottom:170px;opacity:0">
        <div class="sans" style="font-size:38px;font-weight:700;color:${INK}">${esc(S.who || '')}</div>
        <div class="mono" style="margin-top:8px;font-size:22px;letter-spacing:.14em;color:${DIM}">${esc(String(S.role || '').toUpperCase())}</div></div>`;
    const qt = document.getElementById('qt');
    const words = String(S.text || '').split(/\s+/).filter(Boolean);
    const mark = String(S.mark || '').toLowerCase().split(/\s+/).filter(Boolean);
    let mi = -1;
    if (mark.length) for (let i = 0; i + mark.length <= words.length; i++) {
      // a full stop ends the sentence, not the word: "unacceptable." is the mark "unacceptable" (5.5 keeps its point)
      const nm = s => s.toLowerCase().replace(/[^a-z0-9$%.]/g, '').replace(/\.+$/, '');
      if (mark.every((m, k) => nm(words[i + k]) === nm(m))) { mi = i; break; }
    }
    qt.innerHTML = words.map((w, i) => `<span class="qw" style="opacity:0;display:inline-block;margin-right:.26em">${esc(w)}</span>`).join('');
    parts = { ws: [...qt.querySelectorAll('.qw')], mi, ml: mark.length, qw: document.getElementById('qw'), qp: document.getElementById('qp') };
  }

  /* PICKER — "it is in the product now". A plain dark app window with a model selector:
     the menu opens, the models it offers are listed, the new ones arriving with a NEW tag,
     and the cursor travels to the one the story is about and picks it — the check lands,
     the menu closes on it. The list is the scene's (the models the product really offers);
     the window is generic — the product is named, its interface is not copied. */
  if (t === 'picker') {
    dark();
    const models = (S.models || []).slice(0, 6), pick = Math.max(0, Math.min(models.length - 1, Number(S.pick || 0)));
    // the window is as tall as what it holds: two models in a 760 px window left half of it empty
    const RH = 78, WW = 1040, WH = 164 + models.length * RH + 90, WX = 440, WY = Math.round(540 - WH / 2 - 40), MX = WX + 60, MY = WY + 150;
    scene.innerHTML = `
      <div id="pw" style="position:absolute;left:${WX}px;top:${WY}px;width:${WW}px;height:${WH}px;border-radius:20px;background:#141417;
           box-shadow:0 40px 120px rgba(0,0,0,.6),inset 0 0 0 1px rgba(255,255,255,.12);opacity:0">
        <div style="position:absolute;left:0;right:0;top:0;height:60px;background:#18181c;border-radius:20px 20px 0 0;border-bottom:1px solid rgba(255,255,255,.07)"></div>
        <div style="position:absolute;left:24px;top:24px;width:12px;height:12px;border-radius:50%;background:#3a3a3e;box-shadow:20px 0 0 #3a3a3e,40px 0 0 #3a3a3e"></div>
        <div style="position:absolute;left:0;right:0;top:12px;text-align:center">
          ${S.logo ? `<img src="${S.logo}" style="height:26px;vertical-align:middle;margin-right:10px">` : ''}
          <span class="sans" style="font-size:24px;font-weight:600;color:${INK};vertical-align:middle">${esc(S.product || '')}</span></div>
        <div style="position:absolute;left:60px;right:60px;top:88px;height:62px;border-radius:12px;background:#1d1d22;box-shadow:inset 0 0 0 1px rgba(255,255,255,.1)">
          <div class="mono" style="position:absolute;left:22px;top:18px;font-size:20px;letter-spacing:.12em;color:${DIM}">MODEL</div>
          <div id="sel" class="sans" style="position:absolute;left:130px;top:13px;font-size:30px;font-weight:600;color:${INK}">${esc(S.current || 'Auto')}</div>
          <div style="position:absolute;right:22px;top:20px;width:14px;height:14px;border-right:3px solid ${DIM};border-bottom:3px solid ${DIM};transform:rotate(45deg)"></div>
        </div>
        <div id="menu" style="position:absolute;left:60px;right:60px;top:164px;border-radius:14px;background:#202026;
             box-shadow:0 30px 70px rgba(0,0,0,.55),inset 0 0 0 1px rgba(255,255,255,.12);overflow:hidden;transform-origin:50% 0;opacity:0">
          ${models.map((m, i) => `<div class="mi" style="position:relative;height:${RH}px;border-bottom:1px solid rgba(255,255,255,.06)">
              <div style="position:absolute;left:28px;top:20px;display:flex;align-items:center;gap:16px;white-space:nowrap">
                <span class="sans" style="font-size:32px;font-weight:600;color:${INK}">${esc(m.name || '')}</span>
                ${m.new ? `<span class="mono nw" style="padding:3px 10px;border-radius:6px;background:${LIME};color:#0D0D0D;font-size:17px;letter-spacing:.1em;opacity:0">NEW</span>` : ''}
              </div>
              <div class="sans" style="position:absolute;right:70px;top:26px;font-size:22px;color:${DIM}">${esc(m.note || '')}</div>
              <div class="ck" style="position:absolute;right:28px;top:26px;width:12px;height:22px;border-right:4px solid ${OR};border-bottom:4px solid ${OR};transform:rotate(45deg) scale(0)"></div>
            </div>`).join('')}
        </div>
      </div>
      <svg id="cur" width="34" height="46" viewBox="0 0 17 23" style="position:absolute;left:0;top:0;transform-origin:0 0;filter:drop-shadow(0 4px 8px rgba(0,0,0,.6));opacity:0">
        <path d="M1 1 L1 18 L5.2 14 L8.3 21.4 L11.2 20.2 L8.1 13 L14 13 Z" fill="#fff" stroke="#111" stroke-width="1.2" stroke-linejoin="round"/></svg>`;
    parts = { pw: document.getElementById('pw'), menu: document.getElementById('menu'), sel: document.getElementById('sel'),
              items: [...document.querySelectorAll('.mi')], nws: [...document.querySelectorAll('.nw')],
              cks: [...document.querySelectorAll('.ck')], cur: document.getElementById('cur'), pick, models,
              geo: { MX, MY, RH, WX, WY, menuTop: WY + 164 } };
  }

  /* STATS — the week in numbers. Up to four tiles in a grid, each a figure that counts up
     to itself with what it counts under it; they land one after another, the camera
     settling as the last lands, and the one the episode leads with is orange. */
  if (t === 'stats') {
    dark();
    const items = (S.items || []).slice(0, 4), n = items.length;
    const cols = n <= 2 ? n : 2, rows = Math.ceil(n / cols);
    const TW = cols === 1 ? 900 : 700, TH = 300, GX = 40, GY = 40;
    const X0 = (1920 - (cols * TW + (cols - 1) * GX)) / 2, Y0 = (1080 - (rows * TH + (rows - 1) * GY)) / 2 + 30;
    scene.innerHTML = `${S.title ? `<div class="mono" style="position:absolute;left:${X0}px;top:${Y0 - 70}px;font-size:24px;letter-spacing:.16em;color:${LIME}">${esc(String(S.title).toUpperCase())}</div>` : ''}` +
      items.map((it, i) => {
        const x = X0 + (i % cols) * (TW + GX), y = Y0 + Math.floor(i / cols) * (TH + GY);
        return `<div class="st" style="position:absolute;left:${x}px;top:${y}px;width:${TW}px;height:${TH}px;border-radius:20px;background:#141416;
          box-shadow:inset 0 0 0 1px ${it.hot ? 'rgba(255,109,36,.55)' : 'rgba(255,255,255,.1)'};opacity:0">
          <div class="sv sans tnum" style="position:absolute;left:40px;top:44px;font-size:120px;font-weight:800;letter-spacing:-.045em;line-height:1;color:${it.hot ? OR : INK}"></div>
          <div class="sans" style="position:absolute;left:44px;top:196px;right:40px;font-size:34px;line-height:1.25;color:${DIM}">${esc(it.label || '')}</div></div>`;
      }).join('');
    parts = { tiles: [...document.querySelectorAll('.st')], vals: [...document.querySelectorAll('.sv')], items };
  }

  /* EVAL — a test, graded as you watch. A grid of task cells fills one after another:
     each lands as a pass or a fail, the counter above keeping score, until the grid reads
     the published result (42 / 50). Pass is white, fail is dim — orange marks only the
     final score. The cells are the scene's `solved` of `total`; their ORDER is made up, so
     the scene never claims which task failed. */
  if (t === 'eval') {
    dark();
    const total = Math.max(1, Math.min(100, Number(S.total || 50))), solved = Math.max(0, Math.min(total, Number(S.solved || 0)));
    const cols = total <= 20 ? 10 : total <= 50 ? 10 : 20, rows = Math.ceil(total / cols);
    const C = cols === 20 ? 54 : 78, G = cols === 20 ? 10 : 14;
    // the score sits BESIDE the grid: above it, a long title ran into it
    const GW = cols * C + (cols - 1) * G, GH = rows * C + (rows - 1) * G, SIDE = 460;
    const X0 = (1920 - (GW + 70 + SIDE)) / 2, Y0 = Math.max(330, (1080 - GH) / 2 + 40);
    // which cells pass: spread evenly, seeded, so the grid does not read as "the last ones failed"
    const order = Array.from({ length: total }, (_, i) => i);
    let sd = 12345; const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
    for (let i = total - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    const pass = new Set(order.slice(0, solved));
    let cells = '';
    for (let i = 0; i < total; i++) {
      const x = X0 + (i % cols) * (C + G), y = Y0 + Math.floor(i / cols) * (C + G);
      cells += `<div class="ec" data-p="${pass.has(i) ? 1 : 0}" style="position:absolute;left:${x}px;top:${y}px;width:${C}px;height:${C}px;border-radius:${C * .18}px;
        background:#161618;box-shadow:inset 0 0 0 1px rgba(255,255,255,.1)"></div>`;
    }
    scene.innerHTML = `
      <div class="mono" style="position:absolute;left:${X0}px;top:${Y0 - 170}px;font-size:24px;letter-spacing:.16em;color:${LIME}">${esc((S.tag || '').toUpperCase())}</div>
      <div class="sans" style="position:absolute;left:${X0}px;top:${Y0 - 128}px;font-size:48px;font-weight:700;color:${INK}">${esc(S.title || '')}</div>
      <div id="es" class="sans tnum" style="position:absolute;left:${X0 + GW + 70}px;top:${Y0 + GH / 2 - 70}px;font-size:120px;font-weight:800;letter-spacing:-.045em;line-height:1;color:${INK}">0 / ${total}</div>
      <div class="mono" style="position:absolute;left:${X0 + GW + 74}px;top:${Y0 + GH / 2 + 62}px;font-size:22px;letter-spacing:.14em;color:${DIM}">${esc((S.unit || '').toUpperCase())}</div>
      ${cells}`;
    parts = { cells: [...document.querySelectorAll('.ec')], es: document.getElementById('es'), total, solved };
  }

  /* PHONE — it is in the app. A phone rises into frame tilted a few degrees, its screen an
     app bar with the product's name and a single exchange: a message sent, a reply arriving.
     A generic handset and a generic screen: the product is named, its interface is not copied. */
  if (t === 'phone') {
    dark();
    scene.innerHTML = `
      <div id="ph" style="position:absolute;left:${S.caption ? 560 : 730}px;top:120px;width:460px;height:930px;border-radius:64px;background:#0a0a0b;
           box-shadow:0 60px 140px rgba(0,0,0,.7),inset 0 0 0 2px rgba(255,255,255,.16),inset 0 0 0 12px #111;transform-origin:50% 100%">
        <div style="position:absolute;left:14px;top:14px;right:14px;bottom:14px;border-radius:52px;background:#141417;overflow:hidden">
          <div style="position:absolute;left:50%;top:14px;width:120px;height:30px;border-radius:16px;background:#000;transform:translateX(-50%)"></div>
          <div style="position:absolute;left:0;right:0;top:64px;height:74px;border-bottom:1px solid rgba(255,255,255,.08);text-align:center">
            ${S.logo ? `<img src="${S.logo}" style="height:28px;margin-top:22px">` : `<div class="sans" style="margin-top:22px;font-size:26px;font-weight:700;color:${INK}">${esc(S.app || '')}</div>`}</div>
          <div id="pm" class="sans" style="position:absolute;right:26px;top:170px;max-width:300px;padding:16px 20px;border-radius:24px;background:#2c2c32;font-size:24px;
               line-height:1.35;color:${INK};opacity:0">${esc(S.prompt || '')}</div>
          <div id="pr" class="sans" style="position:absolute;left:26px;right:40px;top:290px;font-size:24px;line-height:1.45;color:#e6e6ea;white-space:pre-wrap"></div>
          <div style="position:absolute;left:22px;right:22px;bottom:34px;height:62px;border-radius:31px;background:#222227"></div>
        </div></div>
      ${S.caption ? `<div id="pc2" class="sans" style="position:absolute;left:1140px;top:460px;width:620px;font-size:64px;font-weight:800;letter-spacing:-.03em;line-height:1.1;color:${INK};opacity:0">${esc(S.caption)}</div>` : ''}`;
    parts = { ph: document.getElementById('ph'), pm: document.getElementById('pm'), pr: document.getElementById('pr'),
              pc: document.getElementById('pc2'), words: String(S.reply || '').split(/(\s+)/) };
  }

  /* TICKER — the week so far, running past. A strip of this week's updates slides across
     the frame the way a news channel's band does — each item the company's mark, the model
     and its one figure — then slows and stops with the item the video turns to next centred
     and lit. For a transition, or the roundup before the rundown. */
  if (t === 'ticker') {
    dark();
    const items = (S.items || []).slice(0, 8), focus = Math.max(0, Math.min(items.length - 1, Number(S.focus || 0)));
    const IW = 560;
    scene.innerHTML = `<div id="tk" style="position:absolute;left:0;top:${540 - 90}px;height:180px;width:${items.length * IW + 1920}px;will-change:transform">
      ${items.map((it, i) => `<div class="ti" style="position:absolute;left:${i * IW}px;top:0;width:${IW - 30}px;height:180px;border-radius:18px;background:#141416;
          box-shadow:inset 0 0 0 1px rgba(255,255,255,.1)">
          ${it.logo ? `<img src="${it.logo}" style="position:absolute;left:30px;top:28px;height:34px;max-width:260px;object-fit:contain;object-position:left center">` : ''}
          <div class="sans" style="position:absolute;left:30px;top:78px;font-size:40px;font-weight:800;letter-spacing:-.02em;color:${INK};white-space:nowrap">${esc(it.name || '')}</div>
          <div class="mono" style="position:absolute;left:32px;top:132px;font-size:20px;letter-spacing:.1em;color:${DIM};white-space:nowrap">${esc(String(it.line || '').toUpperCase())}</div>
        </div>`).join('')}</div>`;
    parts = { tk: document.getElementById('tk'), tis: [...document.querySelectorAll('.ti')], focus, IW, n: items.length };
  }

  /* BREACH — an agent getting in where it was told no. The agent on the left, the portal
     as a gate in the middle, the files behind it on the right: requests travel to the gate
     and bounce back refused, once, twice, three times — then a line finds a way round the
     gate and reaches the files that were never public, which open. What was NOT reached
     can be stated at the end (`safe`). A diagram of what happened, drawn as it happens:
     no hooded figure, no green code, no skull. */
  if (t === 'breach') {
    dark();
    const tries = Math.max(1, Math.min(4, Number(S.tries || 3)));
    scene.innerHTML = `
      <svg id="bz" width="1920" height="1080" style="position:absolute;left:0;top:0">
        <path id="way" d="M 470 540 C 620 540, 700 250, 960 230 C 1210 250, 1260 600, 1390 640" fill="none" stroke="${OR}" stroke-width="5" stroke-linecap="round"/>
      </svg>
      <div id="ag" style="position:absolute;left:210px;top:470px;width:260px;height:140px;border-radius:20px;background:#17171a;
           box-shadow:inset 0 0 0 1px rgba(255,255,255,.16);opacity:0">
        ${S.logo ? `<img src="${S.logo}" style="position:absolute;left:30px;top:30px;height:40px;max-width:200px;object-fit:contain;object-position:left center">` : ''}
        <div class="mono" style="position:absolute;left:32px;bottom:26px;font-size:20px;letter-spacing:.16em;color:${DIM}">${esc((S.agent || 'AGENT').toUpperCase())}</div></div>
      <div id="gate" style="position:absolute;left:900px;top:330px;width:120px;height:420px;border-radius:18px;background:#1b1b1f;
           box-shadow:inset 0 0 0 2px rgba(255,255,255,.22);opacity:0">
        <div style="position:absolute;left:44px;top:170px;width:32px;height:30px;border-radius:6px;background:${DIM}"></div>
        <div style="position:absolute;left:49px;top:146px;width:22px;height:30px;border-radius:12px 12px 0 0;border:5px solid ${DIM};border-bottom:none"></div></div>
      <div id="gl" class="mono" style="position:absolute;left:840px;top:780px;width:240px;text-align:center;font-size:22px;letter-spacing:.14em;color:${DIM};opacity:0">${esc((S.gate || 'PORTAL').toUpperCase())}</div>
      <div id="rf" class="mono" style="position:absolute;left:760px;top:282px;width:400px;text-align:center;font-size:24px;letter-spacing:.2em;color:${INK};opacity:0">REFUSED</div>
      <div id="fp" style="position:absolute;left:1390px;top:390px;width:330px;height:110px;border-radius:16px;background:#17171a;box-shadow:inset 0 0 0 1px rgba(255,255,255,.12);opacity:0">
        <div class="mono" style="position:absolute;left:26px;top:22px;font-size:20px;letter-spacing:.14em;color:${DIM}">PUBLIC FILES</div>
        <div class="sans" style="position:absolute;left:26px;top:54px;font-size:30px;font-weight:700;color:#6f6f75">${esc(S.public || '')}</div></div>
      <div id="fn" style="position:absolute;left:1390px;top:580px;width:330px;height:130px;border-radius:16px;background:#17171a;
           box-shadow:inset 0 0 0 2px rgba(255,255,255,.14);opacity:0">
        <div class="mono" style="position:absolute;left:26px;top:22px;font-size:20px;letter-spacing:.14em;color:${DIM}">NON-PUBLIC FILES</div>
        <div id="fnt" class="sans" style="position:absolute;left:26px;top:56px;right:20px;font-size:28px;font-weight:700;line-height:1.2;color:${INK}">${esc(S.files || '')}</div></div>
      <div id="sf" class="sans" style="position:absolute;left:0;width:1920px;top:880px;text-align:center;font-size:40px;font-weight:600;color:${INK};opacity:0">${esc(S.safe || '')}</div>`;
    // the requests: small dots that travel to the gate and bounce
    const hosts = [];
    for (let i = 0; i < tries; i++) {
      const d = document.createElement('div');
      d.style.cssText = `position:absolute;left:0;top:0;width:18px;height:18px;border-radius:50%;background:${INK};opacity:0`;
      scene.appendChild(d); hosts.push(d);
    }
    const way = document.getElementById('way'), L = way.getTotalLength();
    way.style.strokeDasharray = L; way.style.strokeDashoffset = L;
    parts = { ag: document.getElementById('ag'), gate: document.getElementById('gate'), gl: document.getElementById('gl'),
              rf: document.getElementById('rf'), fp: document.getElementById('fp'), fn: document.getElementById('fn'),
              sf: document.getElementById('sf'), way, L, dots: hosts, tries };
  }

  /* ANNOT — the white page. One sentence builds word by word; a phrase gets a black
     box around it as it is spoken; a boxed label hangs off a leader line pointing at
     the word it questions. This is the scene that carries an argument. */
  if (t === 'annot') {
    paper();
    const marks = (S.marks || []).map(m => String(m).toLowerCase());
    const body = String(S.line || '');
    scene.innerHTML = `
      <div id="tx" class="sans" style="position:absolute;left:170px;top:400px;width:1580px;font-size:${S.size || 84}px;
           font-weight:400;line-height:1.28;color:#000;letter-spacing:-.02em"></div>
      <svg id="ld" width="1920" height="1080" style="position:absolute;left:0;top:0;pointer-events:none">
        <path id="lp" fill="none" stroke="#000" stroke-width="2.5" stroke-dasharray="600" stroke-dashoffset="600"/>
        <circle id="ldot" r="7" fill="#000" opacity="0"/></svg>
      <div id="cal" class="sans" style="position:absolute;font-size:44px;font-weight:500;color:#000;border:2.5px solid #000;
           padding:8px 20px;background:${PAPER};opacity:0;white-space:nowrap">${esc(S.label || '')}</div>`;
    const tx = document.getElementById('tx');
    // One span per word, EXCEPT that a marked phrase becomes a single span: boxing
    // each word of "more scale" separately drew two boxes with a gap down the
    // middle, where the reference draws one box around the phrase.
    const raw = body.split(/\s+/);
    const isMark = raw.map(w => {
      const bare = w.replace(/[^\w'-]/g, '').toLowerCase();
      return marks.some(m => m.split(/\s+/).includes(bare));
    });
    const runs = [];
    for (let i = 0; i < raw.length; i++) {
      if (isMark[i] && runs.length && runs[runs.length - 1].m) runs[runs.length - 1].t += ' ' + raw[i];
      else runs.push({ t: raw[i], m: isMark[i] });
    }
    tx.innerHTML = runs.map(r =>
      `<span class="w" data-m="${r.m ? 1 : 0}" style="display:inline-block;opacity:0;white-space:pre">${esc(r.t)}</span><span> </span>`
    ).join('');
    const ws = [...tx.querySelectorAll('.w')];
    const cal = document.getElementById('cal');
    // the callout sits above the marked word and points down at it
    const target = ws.find(w => w.dataset.m === '1') || ws[Math.floor(ws.length / 2)];
    const tr = target.getBoundingClientRect();
    const cx = Math.max(150, Math.min(1500, tr.left + tr.width / 2));
    cal.style.left = px(Math.max(120, cx - 120));
    cal.style.top = px(Math.max(90, tr.top - 210));
    const cr = { x: Math.max(120, cx - 120), y: Math.max(90, tr.top - 210) };
    const lp = document.getElementById('lp');
    const ex = cr.x + 40, ey = cr.y + 66, tx2 = tr.left + tr.width / 2, ty2 = tr.top - 14;
    lp.setAttribute('d', `M${ex},${ey} L${ex},${(ey + ty2) / 2} L${tx2},${(ey + ty2) / 2} L${tx2},${ty2}`);
    const L = lp.getTotalLength(); lp.setAttribute('stroke-dasharray', L); lp.setAttribute('stroke-dashoffset', L);
    const dot = document.getElementById('ldot'); dot.setAttribute('cx', tx2); dot.setAttribute('cy', ty2);
    parts = { ws, cal, lp, L, dot };
  }

  /* BENCH — the benchmark chart. Bars grow, the numbers count up with them, and the
     bar this video is about turns orange and lights. Everything else stays grey:
     the colour IS the argument, so nothing else may use it. */
  if (t === 'bench') {
    dark();
    const rows = (S.rows || []).slice(0, 6);
    const max = Math.max(1, ...rows.map(r => Number(r.value) || 0));
    // A chart's axis reads as computed the moment it says 578 and 1,157, so the
    // gridlines step by a round 1 / 2 / 5 x a power of ten. But rounding the axis
    // TOP up to a round number too left the longest bar at half width — so the
    // scale still ends just past the biggest value, and the last gridline simply
    // falls wherever it falls. That is what the reference does.
    const step = (function (m) {
      const r = m / 4.5, p = Math.pow(10, Math.floor(Math.log10(Math.max(1, r)))), f = r / p;
      return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
    })(max);
    const axisMax = max * 1.06;
    const gridN = Math.floor(axisMax / step);
    const top = 300, gap = Math.min(150, Math.floor(620 / Math.max(1, rows.length)));
    const bh = Math.min(84, Math.floor(gap * 0.62));
    const X0 = 470, X1 = 1720, axisY = top + rows.length * gap + 26;
    scene.innerHTML = `
      <div class="sans" id="tt" style="position:absolute;left:120px;top:120px;font-size:52px;font-weight:600;color:${INK};opacity:0">${esc(S.title || '')}</div>
      <div class="sans" id="sb" style="position:absolute;left:120px;top:190px;font-size:36px;font-weight:400;color:${DIM};opacity:0">${esc(S.sub || '')}</div>
      <svg width="1920" height="1080" style="position:absolute;left:0;top:0">
        ${Array.from({length: gridN + 1}, (_, k) => k * step / axisMax).map(f => `<line x1="${X0 + (X1 - X0) * f}" y1="${top - 30}" x2="${X0 + (X1 - X0) * f}" y2="${axisY}" stroke="#2A2A2E" stroke-width="1.5"/>`).join('')}
      </svg>
      <div id="bars"></div>
      <div id="ax"></div>
      <div class="sans" id="axl" style="position:absolute;left:${(X0 + X1) / 2 - 120}px;top:${axisY + 78}px;width:240px;text-align:center;
           font-size:26px;color:${DIM};opacity:0">${esc(S.axis || '')}</div>`;
    const bs = document.getElementById('bars');
    parts = { rows: [], tt: document.getElementById('tt'), sb: document.getElementById('sb'), axl: document.getElementById('axl') };
    rows.forEach((r, i) => {
      const y = top + i * gap, hot = !!r.hot;
      const w = Math.round((X1 - X0) * (Number(r.value) || 0) / axisMax);
      const el = $(`<div style="position:absolute;left:0;top:${y}px;width:1920px;height:${bh}px">
        <div class="sans" style="position:absolute;left:120px;top:${(bh - 30) / 2}px;width:320px;font-size:${hot ? 28 : 26}px;
             font-weight:${hot ? 600 : 400};color:${hot ? INK : '#B6B6BA'};white-space:nowrap;overflow:hidden">${esc(r.label || '')}
             <span style="color:${DIM};font-weight:400">${esc(r.note || '')}</span></div>
        <div class="bar" style="position:absolute;left:${X0}px;top:0;width:0px;height:${bh}px;background:${hot ? OR : BAR};
             border-radius:3px;box-shadow:none"></div>
        <div class="val sans tnum" style="position:absolute;left:${X0}px;top:${(bh - 34) / 2}px;font-size:30px;font-weight:600;
             color:${hot ? INK : '#C8C8CC'};opacity:0;white-space:nowrap"></div></div>`);
      bs.appendChild(el);
      parts.rows.push({ bar: el.querySelector('.bar'), val: el.querySelector('.val'), w, v: Number(r.value) || 0, hot, dec: r.dec || 0, i });
    });
    const ax = document.getElementById('ax');
    (S.ticks || Array.from({length: gridN + 1}, (_, k) => k * step)).forEach((v, k) => {
      const el = $(`<div class="sans tnum" style="position:absolute;left:${X0 + (X1 - X0) * (v / axisMax) - 60}px;top:${axisY + 22}px;
        width:120px;text-align:center;font-size:24px;color:${DIM};opacity:0">${esc(fmt(v))}</div>`);
      ax.appendChild(el);
    });
    parts.ticks = [...ax.children];
    parts.X0 = X0;
  }

  /* MULTIPLIER — one number, told twice. It counts from the first figure to the
     second while speed lines rush past it, which is how "46x" becomes "99x faster"
     without a cut. Black only: this is the loudest scene in the kit. */
  if (t === 'multiplier') {
    dark('#000');
    grain(0.04);
    scene.innerHTML = `
      <canvas id="ry" class="full"></canvas>
      <div id="row" style="position:absolute;left:0;top:452px;width:1920px;text-align:center;white-space:nowrap">
        <span id="num" class="sans tnum" style="font-size:168px;font-weight:300;color:${INK};letter-spacing:-.04em"></span>
        <span id="unit" class="sans" style="font-size:168px;font-weight:300;color:${INK};letter-spacing:-.03em;opacity:0;margin-left:.22em"></span>
      </div>
      <div id="cap" class="sans" style="position:absolute;left:0;top:672px;width:1920px;text-align:center;font-size:36px;
           font-weight:400;color:${DIM};opacity:0">${esc(S.caption || '')}</div>`;
    const c = document.getElementById('ry').getContext('2d');
    c.canvas.width = W; c.canvas.height = H;
    parts = {
      c, num: document.getElementById('num'), unit: document.getElementById('unit'),
      cap: document.getElementById('cap'),
      a: Number(S.from || 0), b: Number(S.to || S.from || 0), suf: String(S.suffix || 'x'),
      rays: Array.from({ length: 150 }, () => ({ a: Math.random() * Math.PI * 2, r: 120 + Math.random() * 900, l: 40 + Math.random() * 190, w: Math.random() * 1.6 + .3 }))
    };
    parts.unit.textContent = String(S.unit || 'faster');
  }

  /* BOARD — the notebook page: the scene that WRITES the argument instead of stating it.
     A question in a box hangs off a leader line into the highlighted cell the sentence
     starts from, the line types while the camera follows the writing, the view settles
     on a second beat, a black chip turns the argument ("But") and the answer lands under
     it. Give it `line` alone for a single held statement; add `line2` for the turn.
     A $ inside a line is drawn as a money bag. */
  if (t === 'board') {
    paper();
    ground.style.backgroundImage = 'none';   // the grid is drawn on the canvas: it has to travel with the camera
    grain(0.02);
    scene.innerHTML = `<canvas id="bd" class="full"></canvas>`;
    const cv = document.getElementById('bd'); cv.width = W; cv.height = H;
    const c = cv.getContext('2d');
    const FS = Number(S.size || 112), k = FS / 112;
    const FAM = "'Kit Sans',Inter,Helvetica,Arial,sans-serif";
    const l1 = String(S.line || ''), l2 = String(S.line2 || ''), turn = String(S.turn || 'But');
    c.font = `400 ${FS}px ${FAM}`;
    const w1 = c.measureText(l1).width;
    const w2 = c.measureText(l2.replace('$', '')).width + (l2.indexOf('$') >= 0 ? FS * .62 : 0);
    c.font = `400 ${Math.round(FS * 1.30)}px ${FAM}`;
    const chipW = c.measureText(turn).width + FS * .80, chipH = FS * 1.76;
    // The camera's distances come from the type, not from the frame: it drifts just enough
    // to keep the whole first line on screen, then settles where the second line fits whole.
    const pan1 = clamp(BRD.l1x + w1 - 1780, 0, 560);
    const CX = 27 + w1, CY = 631;                       // where it comes to rest
    const x2 = Math.max(120, Math.min(430, (W - w2) / 2 - 170));
    c.font = `400 146px ${FAM}`;                        // the label is set at 146 whatever the body size
    const callW = Math.max(BRD.callw, c.measureText(String(S.call || '')).width + 100);
    parts = {
      c, FS, k, FAM, l1, l2, turn, w1, w2, chipW, chipH, pan1, CX, CY,
      callW, call: String(S.call || ''),
      y1: 308, yc: 308 + 169.5 * k, y2: 308 + 418 * k,   // the final screen rhythm, measured
      x2, has2: !!l2
    };
  }

  /* LOGO — the company's own mark, assembled from the dark. Used the moment a company
     is named, so the viewer knows who this update belongs to before the sentence ends. */
  if (t === 'logo') {
    dark();
    scene.innerHTML = `
      <div id="wrap" style="position:absolute;left:0;top:0;width:1920px;height:1080px;display:flex;align-items:center;justify-content:center;flex-direction:column">
        <img id="lg" src="${S.logo || ''}" style="max-width:1080px;max-height:330px;opacity:0;filter:blur(18px)">
        <div id="ln" class="sans" style="margin-top:56px;font-size:42px;font-weight:400;color:${DIM};opacity:0;text-align:center">${esc(S.line || '')}</div>
      </div>
      <div id="tag" class="mono" style="position:absolute;left:120px;top:110px;font-size:26px;letter-spacing:.22em;
           color:${LIME};opacity:0">${esc((S.tag || '').toUpperCase())}</div>`;
    parts = { lg: document.getElementById('lg'), ln: document.getElementById('ln'), tag: document.getElementById('tag') };
    // no logo on file: the company's name, set as the mark would have been
    if (!S.logo) {
      const w = document.getElementById('wrap');
      w.querySelector('#lg').outerHTML =
        `<div id="lg" class="sans" style="font-size:132px;font-weight:700;letter-spacing:-.03em;color:${INK};opacity:0;filter:blur(18px)">${esc(S.name || '')}</div>`;
      parts.lg = document.getElementById('lg');
    }
  }

  /* POST — a real post, as the platform drew it. The phrases that matter get a black
     box one after another, on the words. Never a retyped quote: the card is a capture. */
  if (t === 'post') {
    dark();
    const marks = (S.marks || []).slice(0, 3);
    let body = esc(S.text || '');
    marks.forEach((m, i) => {
      const e = esc(m);
      body = body.replace(e, `<span class="mk mk${i}" style="background:transparent;color:${INK};padding:1px 6px;border-radius:4px">${e}</span>`);
    });
    scene.innerHTML = `
      <div id="card" style="position:absolute;left:300px;top:190px;width:1320px;background:#16181C;border:1px solid #2B2F36;
           border-radius:24px;padding:46px 52px;opacity:0;box-shadow:0 40px 120px rgba(0,0,0,.6)">
        <div style="display:flex;align-items:center;gap:20px">
          <div style="width:74px;height:74px;border-radius:50%;background:${S.avatar ? `url('${S.avatar}') center/cover` : '#39404A'};flex:none"></div>
          <div>
            <div class="sans" style="font-size:34px;font-weight:600;color:#E7E9EA">${esc(S.who || '')}
              <span style="color:#1D9BF0">✔</span></div>
            <div class="sans" style="font-size:28px;color:#71767B">${esc(S.handle || '')}</div>
          </div>
          <div class="sans" style="margin-left:auto;font-size:28px;color:#71767B">${esc(S.when || '')}</div>
        </div>
        <div id="body" class="sans" style="margin-top:34px;font-size:${S.size || 38}px;line-height:1.45;color:#E7E9EA;font-weight:400">${body}</div>
        ${(S.bullets || []).length ? `<div id="bl" class="sans" style="margin-top:26px;font-size:34px;line-height:1.6;color:#E7E9EA">
          ${(S.bullets || []).map(b => `<div class="bi" style="opacity:0">• ${esc(b)}</div>`).join('')}</div>` : ''}
      </div>`;
    parts = {
      card: document.getElementById('card'),
      mks: marks.map((_, i) => scene.querySelector('.mk' + i)).filter(Boolean),
      bis: [...scene.querySelectorAll('.bi')]
    };
  }

  /* GRID — "12 AI updates this week". The tiles fly in from everywhere and lock into a
     grid, the title types over them, and one spare tile slides out to become the note
     about timestamps. It is the contents page of the video. */
  if (t === 'grid') {
    dark();
    const n = Math.max(4, Math.min(16, Number(S.count) || 12));
    const cols = n > 12 ? 5 : 4, rows = Math.ceil(n / cols);
    const tw = 150, th = 106, gx = 26, gy = 24;
    const gw = cols * tw + (cols - 1) * gx, gh = rows * th + (rows - 1) * gy;
    const ox = (W - gw) / 2, oy = 420;
    scene.innerHTML = `
      <div id="tt" class="sans" style="position:absolute;left:0;top:${oy - 140}px;width:1920px;text-align:center;font-size:56px;
           font-weight:600;color:${INK};opacity:0"></div>
      <div id="tiles"></div>
      <div id="note" class="sans" style="position:absolute;left:${ox + tw + 26}px;top:${oy + gh + 42}px;font-size:32px;
           font-weight:400;color:${DIM};opacity:0">${esc(S.note || '')}</div>`;
    const tt = document.getElementById('tt');
    tt.innerHTML = `<b style="font-weight:700">${esc(S.head || '')}</b> <span class="ser">${esc(S.headItalic || '')}</span> <span style="font-weight:400;color:${DIM}">${esc(S.headTail || '')}</span>`;
    const box = document.getElementById('tiles');
    parts = { tiles: [], tt, note: document.getElementById('note'), ox, oy, tw, th };
    for (let i = 0; i < n; i++) {
      const r = Math.floor(i / cols), c = i % cols;
      const x = ox + c * (tw + gx), y = oy + r * (th + gy);
      const el = $(`<div style="position:absolute;left:${x}px;top:${y}px;width:${tw}px;height:${th}px;border:1.5px solid #34343A;
        border-radius:16px;background:#141418;opacity:0"></div>`);
      box.appendChild(el);
      parts.tiles.push({ el, x, y, fx: (rnd() - .5) * 1500, fy: (rnd() - .5) * 900, fr: (rnd() - .5) * 90, d: rnd() });
    }
    // the spare tile that becomes the timestamps note
    const sp = $(`<div id="spare" style="position:absolute;left:${ox}px;top:${oy + gh + 24}px;width:${tw}px;height:72px;
      border:1.5px solid #34343A;border-radius:14px;background:#141418;opacity:0"></div>`);
    box.appendChild(sp); parts.spare = sp;
  }

  /* HUD — the interface the channel narrates through: a still or clip inside a lime
     window, an identity panel typing itself beside the subject with a leader arrow,
     and the chapter counter this video is on. */
  if (t === 'hud') {
    dark('#111114');
    const wx = 400, wy = 100, ww = 1240, wh = 700;
    scene.innerHTML = `
      <div id="win" style="position:absolute;left:${wx}px;top:${wy}px;width:${ww}px;height:${wh}px;border-radius:14px;
           overflow:hidden;border:2px solid ${LIME};box-shadow:0 0 60px rgba(190,242,66,.16);opacity:0">
        <div id="wi" style="position:absolute;inset:-30px;background:url('${S.photo || S.ground || ''}') center/cover no-repeat"></div>
      </div>
      <svg width="1920" height="1080" style="position:absolute;left:0;top:0;pointer-events:none">
        <path id="arw" fill="none" stroke="#fff" stroke-width="2" stroke-dasharray="400" stroke-dashoffset="400"/>
        <path id="ah" fill="none" stroke="#fff" stroke-width="2" opacity="0"/></svg>
      <div id="panel" style="position:absolute;left:${wx + 96}px;top:${wy + 236}px;width:560px;opacity:0">
        <div style="border:1.6px solid rgba(255,255,255,.9);background:rgba(10,10,12,.45);backdrop-filter:blur(6px);padding:14px 20px;display:flex;align-items:center">
          <span class="mono" id="p1" style="font-size:29px;color:#fff;letter-spacing:.06em;white-space:nowrap"></span>
          <span class="mono" style="margin-left:auto;font-size:24px;color:#fff;opacity:.8">✕</span></div>
        <div style="border:1.6px solid rgba(255,255,255,.9);border-top:none;background:rgba(10,10,12,.45);backdrop-filter:blur(6px);padding:14px 20px">
          <span class="mono" id="p2" style="font-size:27px;color:#fff;letter-spacing:.04em;white-space:nowrap"></span></div>
      </div>
      <div id="strip" style="position:absolute;left:0;top:930px;width:1920px;height:56px"></div>
      <div id="ctr" style="position:absolute;left:0;top:995px;width:1920px;text-align:center;opacity:0">
        <span class="mono" style="border:1.6px solid ${LIME};padding:6px 14px;font-size:30px;color:${LIME}">${esc(S.n || '01')}</span><span
          class="mono" style="font-size:30px;color:${DIM};margin-left:-4px;border:1.6px solid transparent;padding:6px 10px">/${esc(S.of || '12')}</span></div>`;
    const stp = document.getElementById('strip');
    let html = '';
    for (let i = 0; i < 96; i++) {
      const h = 14 + (i % 7 === 0 ? 26 : (i % 3 === 0 ? 16 : 8));
      html += `<div class="tk" style="position:absolute;left:${20 + i * 19.6}px;top:${(56 - h) / 2}px;width:3px;height:${h}px;background:#C9C9CE;opacity:0"></div>`;
    }
    stp.innerHTML = html;
    const arw = document.getElementById('arw');
    const ax0 = wx + 510, ay0 = wy + 400, ax1 = wx + 600, ay1 = wy + 610;
    arw.setAttribute('d', `M${ax0},${ay0} L${ax1},${ay1}`);
    const AL = arw.getTotalLength(); arw.setAttribute('stroke-dasharray', AL); arw.setAttribute('stroke-dashoffset', AL);
    document.getElementById('ah').setAttribute('d', `M${ax1 - 18},${ay1 - 10} L${ax1},${ay1} L${ax1 - 4},${ay1 - 22}`);
    parts = {
      win: document.getElementById('win'), wi: document.getElementById('wi'), panel: document.getElementById('panel'),
      p1: document.getElementById('p1'), p2: document.getElementById('p2'), arw, AL, ah: document.getElementById('ah'),
      tks: [...stp.querySelectorAll('.tk')], ctr: document.getElementById('ctr'),
      t1: String(S.who || '').toUpperCase(), t2: String(S.role || '')
    };
  }

  /* BIGLINE — a statement over footage, set hairline and huge, with the one word that
     carries it in pink. The line arrives a phrase at a time, not all at once. */
  if (t === 'bigline') {
    if (S.photo || S.ground) {
      ground.style.backgroundImage = `url('${S.photo || S.ground}')`;
      ground.style.backgroundSize = 'cover';
      vig.style.background = 'linear-gradient(0deg,rgba(0,0,0,.82) 0%,rgba(0,0,0,.25) 55%,rgba(0,0,0,.1) 100%)';
      grain(0.05);
    } else { dark(); }
    const key = String(S.key || '').toLowerCase();
    scene.innerHTML = `<div id="bx" class="sans" style="position:absolute;left:120px;top:${S.top || 640}px;width:1500px;
      font-size:${S.size || 104}px;font-weight:200;line-height:1.1;color:${INK};letter-spacing:-.035em"></div>`;
    const bx = document.getElementById('bx');
    bx.innerHTML = String(S.line || '').split(/\s+/).map(w => {
      const bare = w.replace(/[^\w'-]/g, '').toLowerCase();
      const hot = key && key.split(/\s+/).includes(bare);
      return `<span class="w" style="display:inline-block;opacity:0;color:${hot ? PINK : INK}">${esc(w)}</span><span> </span>`;
    }).join('');
    parts = { ws: [...bx.querySelectorAll('.w')] };
  }

  /* TYPECARD — the model's name, typed on black and nothing else. The beat before a
     section starts. Restraint is the whole effect: one line, centred, no motion but the type. */
  if (t === 'typecard') {
    dark('#000');
    scene.innerHTML = `
      <div id="tt" class="sans" style="position:absolute;left:0;top:468px;width:1920px;text-align:center;font-size:${S.size || 92}px;
           font-weight:300;color:${INK};letter-spacing:-.03em"></div>
      <div id="sb" class="sans" style="position:absolute;left:0;top:${(S.size || 92) + 500}px;width:1920px;text-align:center;
           font-size:34px;font-weight:400;color:${DIM};opacity:0">${esc(S.sub || '')}</div>`;
    parts = { tt: document.getElementById('tt'), sb: document.getElementById('sb'), txt: String(S.text || '') };
  }

  /* SPEC — the numbers behind a launch: latency, price, context. Mono, in a row of
     cells that fill one after another, each figure counting up to its value. */
  if (t === 'spec') {
    dark();
    const items = (S.items || []).slice(0, 4);
    const cw = 400, gap = 36, tot = items.length * cw + (items.length - 1) * gap;
    const x0 = (W - tot) / 2;
    scene.innerHTML = `
      <div id="tt" class="sans" style="position:absolute;left:0;top:250px;width:1920px;text-align:center;font-size:46px;
           font-weight:500;color:${INK};opacity:0">${esc(S.title || '')}</div>
      <div id="cells"></div>`;
    const box = document.getElementById('cells');
    parts = { cells: [], tt: document.getElementById('tt') };
    items.forEach((it, i) => {
      const el = $(`<div style="position:absolute;left:${x0 + i * (cw + gap)}px;top:410px;width:${cw}px;height:250px;
        border:1.5px solid #2E2E34;border-radius:18px;background:#131317;opacity:0">
        <div class="mono" style="position:absolute;left:0;top:36px;width:${cw}px;text-align:center;font-size:24px;
             letter-spacing:.16em;color:${DIM}">${esc(String(it.label || '').toUpperCase())}</div>
        <div class="v sans tnum" style="position:absolute;left:0;top:92px;width:${cw}px;text-align:center;font-size:76px;
             font-weight:600;color:${it.hot ? OR : INK};letter-spacing:-.03em"></div>
        <div class="sans" style="position:absolute;left:0;top:186px;width:${cw}px;text-align:center;font-size:26px;color:${DIM}">${esc(it.note || '')}</div>
      </div>`);
      box.appendChild(el);
      parts.cells.push({ el, v: el.querySelector('.v'), to: Number(it.value) || 0, dec: it.dec || 0, pre: it.prefix || '', suf: it.suffix || '' });
    });
  }

  /* VERSUS — two models, the same four rows, the winner's side lighting up row by row.
     The comparison the whole channel runs on, done without a table. */
  if (t === 'versus') {
    dark();
    const rows = (S.rows || []).slice(0, 4);
    scene.innerHTML = `
      <div id="ta" class="sans" style="position:absolute;left:120px;top:210px;width:760px;text-align:center;font-size:56px;
           font-weight:700;color:${INK};opacity:0;letter-spacing:-.02em">${esc(S.a || '')}</div>
      <div id="tb" class="sans" style="position:absolute;left:1040px;top:210px;width:760px;text-align:center;font-size:56px;
           font-weight:700;color:${INK};opacity:0;letter-spacing:-.02em">${esc(S.b || '')}</div>
      <div id="vs" class="sans" style="position:absolute;left:880px;top:216px;width:160px;text-align:center;font-size:40px;
           font-weight:300;color:${DIM};opacity:0">vs</div>
      <div id="rows"></div>`;
    const box = document.getElementById('rows');
    parts = { rows: [], ta: document.getElementById('ta'), tb: document.getElementById('tb'), vs: document.getElementById('vs') };
    rows.forEach((r, i) => {
      const y = 372 + i * 158;
      const el = $(`<div style="position:absolute;left:0;top:${y}px;width:1920px;height:112px;opacity:0">
        <div class="mono" style="position:absolute;left:0;top:-44px;width:1920px;text-align:center;font-size:22px;
             letter-spacing:.16em;color:${DIM}">${esc(String(r.label || '').toUpperCase())}</div>
        <div class="ca sans" style="position:absolute;left:120px;top:0;width:760px;height:88px;line-height:88px;text-align:center;
             font-size:40px;font-weight:500;border:1.5px solid #2E2E34;border-radius:14px;background:#131317;color:${INK}">${esc(r.av || '')}</div>
        <div class="cb sans" style="position:absolute;left:1040px;top:0;width:760px;height:88px;line-height:88px;text-align:center;
             font-size:40px;font-weight:500;border:1.5px solid #2E2E34;border-radius:14px;background:#131317;color:${INK}">${esc(r.bv || '')}</div>
      </div>`);
      box.appendChild(el);
      parts.rows.push({ el, ca: el.querySelector('.ca'), cb: el.querySelector('.cb'), win: (r.win || '').toLowerCase() });
    });
  }
}

/* ── frame ────────────────────────────────────────────────────────────────── */
/* ── the camera ─────────────────────────────────────────────────────────────
   Nothing in PULSE sits still. Every scene is filmed rather than displayed: it lands
   a touch too close and settles (the lens catching focus), then the camera keeps
   creeping in for as long as the scene is up. Only the scene layer moves — the
   ground, the grain and the vignette stay put — so the type slides against its own
   texture, which is what makes a flat graphic read as something shot.
   Scenes that already move their own camera get none (board, snap) or a quieter
   version of it; the multiplier gets the hardest push because it is the loudest.  */
const CAM = { board: null, snap: null, tally: null, timeline: null, chat: { a: 1.02, p: 0.03 }, hand: { a: 1.02, p: 0.02 },
  multiplier: { a: 1.10, p: 0.09 }, namecard: { a: 1.03, p: 0.025 },
  hud: { a: 1.04, p: 0.03 }, bigline: { a: 1.05, p: 0.05 } };
function camera(t) {
  const c = S.type in CAM ? CAM[S.type] : { a: 1.055, p: 0.04 };
  if (!c) { scene.style.transform = ''; return; }
  const land = lerp(c.a, 1, eo3(seg(t, 0, .45)));            // lands close, settles in 450 ms
  const push = 1 + c.p * ss(seg(t, .3, D));                 // then creeps in for the rest of the scene
  const drift = lerp(-6, 6, ss(seg(t, 0, D)));               // and slides a few pixels, never back
  scene.style.transformOrigin = '50% 48%';
  scene.style.transform = `translate3d(${drift.toFixed(2)}px,0,0) scale(${(land * push).toFixed(5)})`;
}

function frame(t) {
  camera(t);
  const T = S.type, d = D;

  if (T === 'namecard') {
    // the photo drifts in slowly; the name rows snap up one after another
    const p = seg(t, 0, d);
    parts.ph.style.transform = `scale(${lerp(1.10, 1.0, eo3(seg(t, 0, d * .95)))}) translate3d(${lerp(14, 0, eo3(p))}px,0,0)`;
    parts.rows.forEach((r, i) => {
      const q = seg(t, .12 + i * .13, .72 + i * .13);
      r.style.transform = `translate3d(0,${(1 - eo5(q)) * 118}%,0)`;
      r.style.opacity = q > 0 ? 1 : 0;
    });
    arrive(parts.rl, seg(t, .55, 1.15), { dy: 14, scale: 1 });
    return;
  }

  if (T === 'snap') {
    // the beat the shutter lands on, as a fraction of the scene
    const HIT = Math.min(.30, 1.5 / d);
    const hit = HIT * d;
    // FLASH: full for two frames, then to nothing over 370 ms on (1-p)^2 — the measured
    // fall of the reference. Instant on is what makes it a shutter rather than a dissolve.
    if (parts.burn) {
      const e = t - hit;
      let a = 0;
      if (e >= 0 && e < .37 + .03) a = e <= .03 ? 1 : Math.pow(1 - (e - .03) / .37, 2);
      parts.burn.style.opacity = (a * .96).toFixed(3);
    }
    // PUSH: the shot gives up the left of the frame. Smoothstep, because the page's
    // cubic peaks at three times its average and the move reads as a jerk.
    // seg() takes SECONDS (start, end): the push starts on the flash, not at 0.3 s
    const q = ss(seg(t, hit, hit + .75));
    parts.shot.style.transform =
      `translate3d(${lerp(-56, 188, q)}px,0,0) scale(${lerp(1.10, 1.0, q)})`;
    parts.fade.style.opacity = q.toFixed(3);
    // the mark rises into the black the picture just left
    arrive(parts.mark, seg(t, hit + .08, hit + .53), { dy: 30, scale: 1.04 });
    // the line types under it, a character at a time
    const n = parts.chars.length;
    const t0 = hit + .62, per = Math.min(.028, Math.max(.012, (d * .30) / Math.max(1, n)));
    parts.chars.forEach((c, i) => { c.style.opacity = t >= t0 + i * per ? 1 : 0; });
    return;
  }

  if (T === 'tally') {
    const P = parts, n = P.drums.length, winH = P.winH, s95 = Math.sin(0.95);
    // each drum lands in turn, left to right; the later a drum lands, the more it has spun
    const land = i => .55 + (n > 1 ? i * Math.min(.42, 1.6 / (n - 1)) : 0) + .9;
    const kicks = [];
    P.drums.forEach((dr, i) => {
      const tl = land(i), spins = 3 + i * 2;
      const q = eo3(seg(t, .05, tl));                                  // decelerates into its digit
      const pos = q * (spins * 10 + dr.digit);
      const speed = (seg(t, .05, tl) < 1) ? (1 - q) * (spins * 10 + dr.digit) * 3.2 : 0;   // turns / s, roughly
      const b = Math.floor(pos), fr = pos - b;
      for (let k = 0; k < 3; k++) {
        const idx = b + k - 1, d = (k - 1) - fr, num = ((idx % 10) + 10) % 10;
        if (dr.faces[k].textContent !== String(num)) dr.faces[k].textContent = String(num);
        const th = clamp(d, -1.3, 1.3) * .95;
        const y = P.F * .05 + Math.sin(th) / s95 * winH, sy = lerp(1, Math.cos(th), .55);
        dr.faces[k].style.transform = `translate3d(0,${y.toFixed(2)}px,0) scaleY(${sy.toFixed(4)})`;
      }
      const sig = Math.min(.11 * winH, speed * winH / 260);
      if (sig > .4) { dr.blur.setAttribute('stdDeviation', `0 ${sig.toFixed(2)}`); dr.strip.style.filter = `url(#${dr.id})`; }
      else dr.strip.style.filter = 'none';
      kicks.push(tl);
    });
    // a clunk through the whole figure as each drum stops: damped kicks, heavier on the last
    let jolt = 0;
    kicks.forEach((k, i) => { const tau = t - k; if (tau >= 0) jolt += (i === n - 1 ? 7 : 3) * Math.sin(2 * Math.PI * 9 * tau) * Math.exp(-14 * tau); });
    // the camera: starts on the last drum so close that one digit fills the frame, then pulls back
    const lastLand = n ? land(n - 1) : .8;
    const z = ss(seg(t, .35, lastLand + .55));
    const sc = lerp(3.1, 1, z);
    // the focus point travels to the frame centre as the camera pulls back, so at z = 1 the
    // transform is exactly identity and the figure lands where the caption expects it
    const fx = lerp(P.focusX, 960, z), fy = lerp(470, 540, z);
    P.tw.style.transform = `translate3d(${(960 - fx * sc).toFixed(1)}px,${(540 - fy * sc + jolt).toFixed(1)}px,0) scale(${sc.toFixed(4)})`;
    P.tw.style.transformOrigin = '0 0';
    P.ul.style.transform = `scaleX(${eo3(seg(t, lastLand + .15, lastLand + .75)).toFixed(4)})`;
    arrive(P.cap, seg(t, lastLand + .45, lastLand + 1.05), { dy: 16, scale: 1 });
    P.tag.style.opacity = eo3(seg(t, lastLand + .3, lastLand + .8)).toFixed(3);
    return;
  }

  if (T === 'hand') {
    const P = parts, mid = (P.n - 1) / 2;
    P.els.forEach((el, i) => {
      // the deal: every card rises from below as one deck, then fans out in turn
      const deal = eo3(seg(t, 0, .55));
      const fan = eback(seg(t, .62 + i * .09, .62 + i * .09 + .66));
      let rot = (i - mid) * P.step * fan, x = 0, y = lerp(520, 0, deal) - 22 * Math.sin(Math.PI * fan);
      let sc = 1, rz = 0, spin = 0, blur = 0, op = 1;
      if (P.hero >= 0) {
        const q = ss(seg(t, P.pullAt, P.pullAt + .9));
        if (i === P.hero) {
          // out of the hand, up and forward, a full turn in the air, landing right of centre
          rot = lerp(rot, 0, q);
          x = lerp(0, 330, q);
          y = y - 230 * Math.sin(Math.PI * Math.min(1, q * 1.2)) * (1 - q) + lerp(0, -70, q);
          sc = lerp(1, 1.34, q);
          spin = 360 * ss(seg(t, P.pullAt + .05, P.pullAt + .8));
          rz = 1;
          const strip = el.querySelector('.strip');
          strip.style.transform = `scaleX(${eo3(seg(t, P.pullAt + .75, P.pullAt + 1.25)).toFixed(4)})`;
        } else {
          // the rest of the hand sinks low-left and out of focus
          x = lerp(0, -200, q); y = y + lerp(0, 470, q); blur = 7 * q; op = lerp(1, .62, q);
        }
      }
      el.style.zIndex = i === P.hero && t > P.pullAt ? 50 : i;
      el.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) rotate(${rot.toFixed(3)}deg) rotateY(${spin.toFixed(2)}deg) scale(${sc.toFixed(4)})`;
      el.style.transformOrigin = rz ? '50% 50%' : `50% ${308 + 860}px`;
      el.style.filter = blur > .05 ? `blur(${blur.toFixed(2)}px)` : 'none';
      el.style.opacity = op.toFixed(3);
    });
    if (P.hero >= 0) arrive(P.ht, seg(t, P.pullAt + .85, P.pullAt + 1.45), { dy: 24, scale: 1.02 });
    return;
  }

  if (T === 'race') {
    const P = parts, d = D;
    const stop = d * .70;                                   // the freeze: a frame before the finish
    const tt = Math.min(t, stop);
    P.rt.style.opacity = eo3(seg(t, .05, .5)).toFixed(3);
    P.els.forEach((e, k) => {
      const inn = eo3(seg(t, .1 + k * .08, .6 + k * .08));
      e.root.style.opacity = inn.toFixed(3);
      e.root.style.transform = `translate3d(0,${((1 - inn) * 40).toFixed(1)}px,0)`;
      // the prompt types in both at once
      const np = Math.floor(P.prompt.length * seg(tt, .6, 1.5));
      e.prm.textContent = P.prompt.slice(0, np) + (tt < 1.6 && Math.floor(t * 3) % 2 ? '▍' : '');
      // then the code streams; the two runs move at the same pace, a hair out of step
      const run = seg(tt, 1.7, stop), jitter = .015 * Math.sin(t * 7 + k * 2);
      const q = clamp(run * (1 + (k ? -1 : 1) * jitter), 0, 1);
      const shown = Math.floor(q * (P.code.length - 4));
      const first = Math.max(0, shown - 17);
      e.code.textContent = P.code.slice(first + k * 2, shown + k * 2).join('\n');
      e.tok.textContent = `${fmt(Math.round(q * 4180 + (q > 0 ? k * 37 : 0)))} tok`;
      e.bar.style.transform = `scaleX(${(q * .86).toFixed(4)})`;
      // at the freeze the panes dim so the chip owns the frame
      e.root.style.filter = t > stop ? `brightness(${lerp(1, .45, eo3(seg(t, stop, stop + .35))).toFixed(3)})` : 'none';
    });
    const c = seg(t, stop + .05, stop + .5);
    P.chip.style.opacity = eo3(c).toFixed(3);
    P.chip.style.transform = `translate(-50%,-50%) scale(${lerp(.6, 1, eback(c)).toFixed(4)})`;
    return;
  }

  if (T === 'chat') {
    const P = parts, d = D;
    const inn = eo3(seg(t, 0, .55));
    P.cw.style.opacity = inn.toFixed(3);
    P.cw.style.transform = `translate3d(0,${((1 - inn) * 60).toFixed(1)}px,0) scale(${lerp(.97, 1, inn).toFixed(4)})`;
    // the prompt types into the box, then is sent into its bubble
    const typeEnd = Math.min(2.1, .6 + P.prompt.length * .028), sent = typeEnd + .25;
    const np = Math.floor(P.prompt.length * seg(t, .6, typeEnd));
    P.ib.textContent = t < sent ? P.prompt.slice(0, np) + (Math.floor(t * 3) % 2 ? '▍' : '') : '';
    P.sb.style.background = t > typeEnd && t < sent + .2 ? '#ffffff' : '#3a3a40';
    const ub = seg(t, sent, sent + .35);
    P.ub.textContent = P.prompt;
    P.ub.style.opacity = eo3(ub).toFixed(3);
    P.ub.style.transform = `translate3d(0,${((1 - eo3(ub)) * 26).toFixed(1)}px,0)`;
    // the answer streams word by word, the cursor at its end, until a second before the cut
    const a0 = sent + .45, a1 = Math.max(a0 + .5, d - .9);
    const n = Math.floor(P.words.length * seg(t, a0, a1));
    P.ab.textContent = P.words.slice(0, n).join('') + (t > a0 && t < a1 + .5 ? '▍' : '');
    // scroll so the newest line stays in view
    const over = P.cs.scrollHeight - P.cv.clientHeight;
    P.cs.style.transform = `translate3d(0,${(-Math.max(0, over)).toFixed(1)}px,0)`;
    return;
  }

  if (T === 'pricecut') {
    const P = parts;
    arrive(P.old, seg(t, 0, .45), { dy: 20, scale: 1.02 });
    P.strike.style.transform = `rotate(-12deg) scaleX(${eo3(seg(t, .8, 1.15)).toFixed(4)})`;
    // the old price dims and drifts up and away; the strike goes with it
    const up = ss(seg(t, 1.25, 1.8));
    P.old.style.transform = `translate3d(0,${(-200 * up).toFixed(1)}px,0) scale(${lerp(1, .42, up).toFixed(4)})`;
    P.old.style.opacity = lerp(1, .38, up).toFixed(3);
    // the new price drops in from above and lands with a bounce
    const dn = seg(t, 1.45, 2.05), e = eback(dn);
    P.nw.style.opacity = eo3(seg(t, 1.45, 1.7)).toFixed(3);
    P.nw.style.transform = `translate3d(0,${(-260 * (1 - e)).toFixed(1)}px,0)`;
    // the saving counts up in a chip to the right of the new price
    const cs = seg(t, 2.0, 2.6);
    P.chip.textContent = `−${Math.round(P.pct * eo3(cs))}%`;
    P.chip.style.opacity = eo3(seg(t, 2.0, 2.25)).toFixed(3);
    P.chip.style.left = '1380px'; P.chip.style.top = '470px';
    P.chip.style.transform = `scale(${lerp(.7, 1, eback(seg(t, 2.0, 2.4))).toFixed(4)})`;
    arrive(P.pc, seg(t, 2.3, 2.85), { dy: 14, scale: 1 });
    P.tag.style.opacity = eo3(seg(t, .2, .7)).toFixed(3);
    return;
  }

  if (T === 'breakout') {
    const P = parts;
    P.bl.style.opacity = eo3(seg(t, 0, .4)).toFixed(3);
    P.core.style.opacity = eo3(seg(t, .1, .5)).toFixed(3);
    P.srv.forEach((el, i) => { el.style.opacity = (.55 * eo3(seg(t, .3 + i * .1, .8 + i * .1))).toFixed(3); });
    // the line leaves the model and runs through the gap in the box out to the internet
    const q0 = ss(seg(t, .9, 2.0));
    P.p0.style.strokeDashoffset = (P.p0.dataset.L * (1 - q0)).toFixed(1);
    P.gl.style.opacity = eo3(seg(t, 1.35, 1.75)).toFixed(3);
    P.net.setAttribute('opacity', eo3(seg(t, 1.9, 2.1)).toFixed(3));
    P.nl.style.opacity = eo3(seg(t, 1.95, 2.35)).toFixed(3);
    // then it branches to every server, each lighting as the line reaches it
    P.bs.forEach((b, i) => {
      const s0 = 2.15 + i * .28, q = ss(seg(t, s0, s0 + .7));
      b.style.strokeDashoffset = (b.dataset.L * (1 - q)).toFixed(1);
      const lit = eo3(seg(t, s0 + .6, s0 + .85));
      P.srv[i].style.opacity = lerp(.55, 1, lit).toFixed(3);
      P.srv[i].style.boxShadow = `inset 0 0 0 ${lerp(1, 2, lit).toFixed(2)}px rgba(255,109,36,${(.12 + .8 * lit).toFixed(3)}),0 0 ${(40 * lit).toFixed(1)}px rgba(255,109,36,${(.35 * lit).toFixed(3)})`;
      P.leds[i].style.background = lit > .5 ? OR : '#2a2a2e';
    });
    return;
  }

  if (T === 'leaderboard') {
    const P = parts;
    // the climb: 0 at the start (subject at `from`), 1 when it has reached its rank
    const c = ss(seg(t, 1.1, 2.6));
    P.els.forEach((el, i) => {
      let slot;
      if (i === P.hot) slot = lerp(P.from, P.hot, c);
      else if (i > P.hot && i <= P.from) slot = lerp(i - 1, i, c);      // rows it passes step down to make room
      else slot = i;
      const inn = eo3(seg(t, .1 + i * .06, .6 + i * .06));
      // the climbing row lifts off the table while it passes, so an overtake reads as
      // passing OVER the others — two rows of equal size simply swapped and vanished
      const lift = i === P.hot ? Math.sin(Math.PI * c) : 0;
      // 140 px out to the side: at 34 px the 4 % scale-up ate the offset and the row it
      // passed was left showing 8 px — the overtake looked like a row disappearing
      const passed = i !== P.hot && i > P.hot && i <= P.from ? Math.sin(Math.PI * c) : 0;
      el.style.transform = `translate3d(${((1 - inn) * -60 + 140 * lift).toFixed(1)}px,${(slot * P.RH).toFixed(1)}px,0) scale(${(1 + .03 * lift).toFixed(4)})`;
      el.style.opacity = (inn * (1 - .35 * passed)).toFixed(3);
      if (i === P.hot && c > 0 && c < 1) el.style.filter = `drop-shadow(0 ${(24 * lift).toFixed(1)}px ${(40 * lift).toFixed(1)}px rgba(0,0,0,.7))`;
      else el.style.filter = 'none';
      el.style.zIndex = i === P.hot ? 10 : 1;
      el.querySelector('.rk').textContent = '#' + (Math.round(slot) + 1);
      const r = P.rows[i];
      const sc = el.querySelector('.sc');
      if (i === P.hot && P.old) sc.textContent = fmt(lerp(P.old, Number(r.score || 0), eo3(seg(t, 1.1, 2.6))), r.dec || 0);
      else sc.textContent = r.score != null ? fmt(Number(r.score), r.dec || 0) : '';
      if (i === P.hot) {
        const lit = eo3(seg(t, 2.6, 3.0));
        el.style.boxShadow = `inset 0 0 0 ${lerp(1, 2.5, lit).toFixed(2)}px rgba(255,109,36,${(.08 + .9 * lit).toFixed(3)}),0 0 ${(50 * lit).toFixed(1)}px rgba(255,109,36,${(.3 * lit).toFixed(3)})`;
        el.querySelector('.rk').style.color = lit > .5 ? OR : DIM;
      }
    });
    return;
  }

  if (T === 'timeline') {
    const P = parts, n = P.n, d = D;
    // the camera travels from the first date to the last, settling on it
    const q = ss(seg(t, .3, Math.max(1.2, d - 1.6)));
    const x = -(n - 1) * P.GAP * q;
    P.tl.style.transform = `translate3d(${x.toFixed(1)}px,0,0)`;
    P.dots.forEach((dot, i) => {
      // a date pops as the camera reaches it
      const reach = n > 1 ? .3 + (Math.max(1.2, d - 1.6) - .3) * (i / (n - 1)) - .25 : .3;
      const k = seg(t, reach, reach + .35);
      dot.style.transform = `scale(${eback(k).toFixed(4)})`;
      P.dates[i].style.opacity = eo3(seg(t, reach + .05, reach + .4)).toFixed(3);
      arrive(P.labs[i], seg(t, reach + .1, reach + .55), { dy: 18, scale: 1 });
    });
    if (P.ring) {
      const tEnd = Math.max(1.2, d - 1.6), k = seg(t, tEnd, tEnd + .8);
      P.ring.style.opacity = (k > 0 && k < 1 ? 1 - k : 0).toFixed(3);
      P.ring.style.transform = `scale(${lerp(1, 3.2, eo3(k)).toFixed(4)})`;
    }
    return;
  }

  if (T === 'flip') {
    const P = parts;
    [0, 1].forEach(k => {
      // a digit that does not change keeps still; the one that changes flips, the right one a beat later
      const t0 = .35 + k * .12;
      const a = P.changed[k] ? seg(t, t0, t0 + .22) : 1, b = P.changed[k] ? seg(t, t0 + .22, t0 + .46) : 1;
      P.ft[k].style.transform = `rotateX(${(-90 * (a * a)).toFixed(2)}deg)`;               // falls, accelerating
      P.ft[k].style.visibility = a >= 1 ? 'hidden' : 'visible';
      P.fb[k].style.transform = `rotateX(${(90 * (1 - eback(b))).toFixed(2)}deg)`;         // lands with a little bounce
      P.fb[k].style.visibility = b <= 0 ? 'hidden' : 'visible';
    });
    P.fo.style.opacity = eo3(seg(t, .2, .6)).toFixed(3);
    arrive(P.fn, seg(t, .95, 1.5), { dy: 30, scale: 1.02 });
    P.fr.style.transform = `scaleX(${eo3(seg(t, 1.2, 1.9)).toFixed(4)})`;
    return;
  }

  if (T === 'context') {
    const P = parts, d = D;
    const fill = ss(seg(t, .4, Math.max(1.4, d - 1.4)));
    P.cn.textContent = fmt(Math.round(P.cap * eo3(seg(t, .4, Math.max(1.4, d - 1.4)))));
    P.cf.style.transform = `scaleX(${fill.toFixed(4)})`;
    // each page flies in from off the right and lands at its place along the window
    P.sheets.forEach((el, i) => {
      const f = i / (P.N - 1), land = .4 + (Math.max(1.4, d - 1.4) - .4) * f;
      const q = eo3(seg(t, land - .45, land));
      const x = lerp(P.BW + 200 + i * 7, 8 + f * (P.BW - 80), q);
      el.style.opacity = (q > 0 ? Math.min(1, q * 2) : 0).toFixed(3);
      el.style.transform = `translate3d(${x.toFixed(1)}px,${(Math.sin(i * 1.7) * 6 * (1 - q)).toFixed(1)}px,0) rotate(${((1 - q) * (i % 2 ? 9 : -9)).toFixed(2)}deg)`;
    });
    P.cm.forEach((el, i) => {
      const at = Number(P.marks[i].at || 0) / P.cap, when = .4 + (Math.max(1.4, d - 1.4) - .4) * at;
      el.style.opacity = eo3(seg(t, when, when + .3)).toFixed(3);
      arrive(P.cml[i], seg(t, when, when + .4), { dy: 10, scale: 1 });
    });
    return;
  }

  if (T === 'quote') {
    const P = parts, n = P.ws.length, d = D;
    const per = Math.min(.12, (d * .55) / Math.max(1, n));
    P.ws.forEach((w, i) => {
      const q = seg(t, .35 + i * per, .35 + i * per + .3);
      w.style.opacity = eo3(q).toFixed(3);
      w.style.transform = `translate3d(0,${((1 - eo3(q)) * 18).toFixed(1)}px,0)`;
      const inMark = P.mi >= 0 && i >= P.mi && i < P.mi + P.ml;
      w.style.color = inMark && q > .6 ? PINK : '';
    });
    if (P.qp) P.qp.style.transform = `scale(${lerp(1.08, 1, eo3(seg(t, 0, d))).toFixed(4)})`;
    arrive(P.qw, seg(t, .35 + n * per + .1, .35 + n * per + .6), { dy: 14, scale: 1 });
    return;
  }

  if (T === 'picker') {
    const P = parts, G = P.geo;
    // in a slot shorter than the full move the whole pick runs faster rather than being cut before the click
    t = t / Math.min(1, D / 4.0);
    const inn = eo3(seg(t, 0, .5));
    P.pw.style.opacity = inn.toFixed(3);
    P.pw.style.transform = `translate3d(0,${((1 - inn) * 50).toFixed(1)}px,0)`;
    // the menu opens under the selector; its rows arrive in turn, the new ones tagged
    const open = seg(t, .8, 1.15), close = seg(t, 3.25, 3.5);
    P.menu.style.opacity = (eo3(open) * (1 - close)).toFixed(3);
    P.menu.style.transform = `scaleY(${(lerp(.6, 1, eback(open)) * lerp(1, .9, close)).toFixed(4)})`;
    P.items.forEach((el, i) => {
      const q = eo3(seg(t, .9 + i * .07, 1.25 + i * .07));
      el.style.opacity = q.toFixed(3);
      el.style.transform = `translate3d(${((1 - q) * -20).toFixed(1)}px,0,0)`;
      el.style.background = i === P.pick && t > 2.55 ? 'rgba(255,109,36,.12)' : (i === P.pick && t > 2.1 ? 'rgba(255,255,255,.06)' : 'transparent');
    });
    P.nws.forEach((el, i) => { el.style.opacity = eo3(seg(t, 1.25 + i * .1, 1.5 + i * .1)).toFixed(3); });
    // the cursor travels from the selector to the picked row, clicks, and the check lands
    const tx = G.MX + 460, ty = G.menuTop + P.pick * G.RH + G.RH * .45;
    const m1 = ss(seg(t, .45, .8)), m2 = ss(seg(t, 1.5, 2.3));
    const x = lerp(lerp(1500, G.MX + 560, m1), tx, m2), y = lerp(lerp(900, G.WY + 120, m1), ty, m2);
    const click = seg(t, 2.35, 2.55), press = Math.sin(Math.PI * click);
    P.cur.style.opacity = (eo3(seg(t, .35, .6)) * (1 - seg(t, 3.4, 3.7))).toFixed(3);
    P.cur.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) scale(${(1 - .15 * press).toFixed(3)})`;
    P.cks.forEach((el, i) => { el.style.transform = `rotate(45deg) scale(${i === P.pick ? eback(seg(t, 2.5, 2.8)).toFixed(4) : 0})`; });
    // the menu closes on the choice: the selector now reads it
    if (t > 3.3) P.sel.textContent = String((P.models[P.pick] || {}).name || '');
    P.sel.style.color = t > 3.3 ? OR : INK;
    return;
  }

  if (T === 'stats') {
    const P = parts;
    P.tiles.forEach((el, i) => {
      // a tile may land on its own words (item.at, seconds) instead of right after the one before
      const t0 = P.items[i].at != null ? Number(P.items[i].at) : .2 + i * .32, q = seg(t, t0, t0 + .5);
      el.style.opacity = eo3(q).toFixed(3);
      el.style.transform = `translate3d(0,${((1 - eo3(q)) * 40).toFixed(1)}px,0) scale(${lerp(.94, 1, eback(q)).toFixed(4)})`;
      const it = P.items[i], c = eo3(seg(t, t0 + .1, t0 + 1.1));
      P.vals[i].textContent = it.text ? it.text : (it.prefix || '') + fmt(Number(it.value || 0) * c, it.dec || 0) + (it.suffix || '');
    });
    return;
  }

  if (T === 'eval') {
    const P = parts, n = P.cells.length, d = D;
    const end = Math.max(1.4, d - 1.2), per = (end - .4) / n;
    let score = 0;
    P.cells.forEach((el, i) => {
      const t0 = .4 + i * per, q = seg(t, t0, t0 + .18);
      const ok = el.dataset.p === '1';
      if (q > 0) {
        if (ok && q >= 1) score++;
        el.style.background = ok ? `rgba(255,255,255,${(.92 * eo3(q)).toFixed(3)})` : `rgba(255,255,255,${(.06 * eo3(q)).toFixed(3)})`;
        el.style.boxShadow = ok ? 'none' : `inset 0 0 0 1px rgba(255,255,255,.16)`;
        el.style.transform = `scale(${lerp(.6, 1, eback(q)).toFixed(4)})`;
      }
    });
    P.es.textContent = `${score} / ${P.total}`;
    P.es.style.color = t > end + .2 ? OR : INK;
    return;
  }

  if (T === 'phone') {
    const P = parts, d = D;
    const up = eback(seg(t, 0, .8));
    P.ph.style.transform = `translate3d(0,${((1 - up) * 700).toFixed(1)}px,0) rotate(${lerp(-9, -4, eo3(seg(t, 0, d))).toFixed(3)}deg)`;
    const m = seg(t, .9, 1.25);
    P.pm.style.opacity = eo3(m).toFixed(3);
    P.pm.style.transform = `translate3d(0,${((1 - eo3(m)) * 20).toFixed(1)}px,0)`;
    const a0 = 1.5, a1 = Math.max(a0 + .5, d - .8);
    const k = Math.floor(P.words.length * seg(t, a0, a1));
    P.pr.textContent = P.words.slice(0, k).join('') + (t > a0 && t < a1 + .4 ? '▍' : '');
    if (P.pc) arrive(P.pc, seg(t, .6, 1.2), { dy: 24, scale: 1.02 });
    return;
  }

  if (T === 'ticker') {
    const P = parts, d = D;
    // runs fast, then eases to a stop with the focus item centred
    const stopX = -(P.focus * P.IW) + (960 - (P.IW - 30) / 2);
    const startX = stopX + 2600;
    const q = eo5(seg(t, 0, Math.max(1.2, d * .62)));
    P.tk.style.transform = `translate3d(${lerp(startX, stopX, q).toFixed(1)}px,0,0)`;
    const lit = eo3(seg(t, Math.max(1.2, d * .62) - .1, Math.max(1.2, d * .62) + .35));
    P.tis.forEach((el, i) => {
      const f = i === P.focus;
      el.style.boxShadow = f ? `inset 0 0 0 ${lerp(1, 3, lit).toFixed(2)}px rgba(255,109,36,${(.1 + .85 * lit).toFixed(3)}),0 0 ${(50 * lit).toFixed(1)}px rgba(255,109,36,${(.3 * lit).toFixed(3)})` : 'inset 0 0 0 1px rgba(255,255,255,.1)';
      el.style.opacity = f ? 1 : lerp(1, .45, lit).toFixed(3);
      el.style.transform = f ? `scale(${lerp(1, 1.06, lit).toFixed(4)})` : 'none';
    });
    return;
  }

  if (T === 'breach') {
    const P = parts, d = D;
    // everything scales to the scene: the attempts take the first 40 %, the way round the next 25 %
    const k = d / 11.2;
    const at = x => x * k;
    P.ag.style.opacity = eo3(seg(t, 0, at(.6))).toFixed(3);
    P.gate.style.opacity = eo3(seg(t, at(.2), at(.8))).toFixed(3);
    P.gl.style.opacity = eo3(seg(t, at(.4), at(1.0))).toFixed(3);
    P.fp.style.opacity = eo3(seg(t, at(.5), at(1.1))).toFixed(3);
    P.fn.style.opacity = (.55 * eo3(seg(t, at(.6), at(1.2)))).toFixed(3);
    // the refused attempts: out to the gate, a flash, back
    let flash = 0, shake = 0;
    P.dots.forEach((dot, i) => {
      const t0 = at(1.2 + i * 1.05), go = seg(t, t0, t0 + at(.45)), back = seg(t, t0 + at(.45), t0 + at(.8));
      const x = back > 0 ? lerp(890, 480, eo3(back)) : lerp(480, 890, ei3(go));
      dot.style.opacity = go > 0 && back < 1 ? '1' : '0';
      dot.style.transform = `translate3d(${x.toFixed(1)}px,531px,0)`;
      // each refusal flashes the gate and holds REFUSED long enough to read (a 0.2 s flash was never seen)
      const f = seg(t, t0 + at(.45), t0 + at(1.0));
      if (f > 0 && f < 1) { flash = Math.max(flash, Math.pow(1 - f, 1.5)); shake = Math.sin(f * Math.PI * 7) * Math.max(0, 1 - f * 2.2) * 9; }
    });
    P.gate.style.boxShadow = `inset 0 0 0 2px rgba(255,255,255,${(.22 + .7 * flash).toFixed(3)}),0 0 ${(60 * flash).toFixed(1)}px rgba(255,255,255,${(.25 * flash).toFixed(3)})`;
    P.gate.style.transform = `translate3d(${shake.toFixed(2)}px,0,0)`;
    P.rf.style.opacity = Math.min(1, flash * 1.6).toFixed(3);
    // then the way round the gate, and the non-public files open
    const w0 = at(4.6), q = ss(seg(t, w0, w0 + at(2.2)));
    P.way.style.strokeDashoffset = (P.L * (1 - q)).toFixed(1);
    const open = eo3(seg(t, w0 + at(2.0), w0 + at(2.6)));
    P.fn.style.opacity = lerp(.55, 1, open).toFixed(3);
    P.fn.style.boxShadow = `inset 0 0 0 ${lerp(2, 3, open).toFixed(2)}px rgba(255,109,36,${(.14 + .8 * open).toFixed(3)}),0 0 ${(60 * open).toFixed(1)}px rgba(255,109,36,${(.3 * open).toFixed(3)})`;
    // what was NOT reached lands when the narration says it (safe_at, seconds), else at 77 % of the scene
    const sa = S.safe_at != null ? Number(S.safe_at) : at(8.6);
    arrive(P.sf, seg(t, sa, sa + at(.7)), { dy: 18, scale: 1 });
    return;
  }

  if (T === 'annot') {
    const n = parts.ws.length, per = Math.min(.085, (d * .42) / Math.max(1, n));
    parts.ws.forEach((w, i) => {
      const q = seg(t, .25 + i * per, .25 + i * per + .28);
      w.style.opacity = q;
      w.style.transform = `translate3d(0,${(1 - eo5(q)) * 16}px,0)`;
      // the black box lands a beat after the phrase is read, not with it
      if (w.dataset.m === '1') {
        const m = seg(t, .3 + i * per + .5, .3 + i * per + .78);
        w.style.background = m > 0 ? '#000' : 'transparent';
        w.style.color = m > .5 ? '#fff' : '#000';
        w.style.padding = m > 0 ? '2px 10px' : '0';
        w.style.transform = `translate3d(0,${(1 - eo5(q)) * 16}px,0) scale(${lerp(1, 1.02, m)})`;
      }
    });
    const lp = seg(t, .55, 1.5);
    parts.lp.style.strokeDashoffset = parts.L * (1 - eo3(lp));
    parts.dot.style.opacity = lp > .9 ? 1 : 0;
    arrive(parts.cal, seg(t, 1.3, 1.95), { dy: -12, scale: .96 });
    return;
  }

  if (T === 'bench') {
    arrive(parts.tt, seg(t, .1, .8), { dy: 16, scale: 1 });
    arrive(parts.sb, seg(t, .25, .95), { dy: 12, scale: 1 });
    parts.ticks.forEach((el, i) => { el.style.opacity = seg(t, .5 + i * .05, .9 + i * .05) * .9; });
    parts.axl.style.opacity = seg(t, .9, 1.4) * .9;
    parts.rows.forEach(r => {
      const g = seg(t, .7 + r.i * .16, 2.0 + r.i * .16);      // the bar grows
      const e = eo3(g);
      r.bar.style.width = px(Math.round(r.w * e));
      r.val.style.left = px(parts.X0 + r.w * e + 22);
      r.val.style.opacity = g > .06 ? 1 : 0;
      r.val.textContent = count(r.v, g, r.dec);
      if (r.hot) {
        // the subject's bar lights only once it has finished growing: the glow is the verdict
        const h = seg(t, 2.0 + r.i * .16, 2.7 + r.i * .16);
        r.bar.style.boxShadow = h > 0 ? `0 0 ${28 * h}px rgba(255,109,36,${.55 * h})` : 'none';
        r.bar.style.background = OR;
      }
    });
    return;
  }

  if (T === 'multiplier') {
    const c = parts.c;
    c.clearRect(0, 0, W, H);
    const rush = seg(t, 0, d);
    c.save(); c.translate(W / 2, H / 2 - 40);
    c.globalAlpha = .5 * Math.min(1, seg(t, 0, .4) * 1.6) * (1 - seg(t, d - .6, d));
    parts.rays.forEach(r => {
      const rr = r.r + rush * 620;                            // lines rush outward past the frame
      c.strokeStyle = '#FFFFFF'; c.lineWidth = r.w;
      c.globalAlpha = .34 * (1 - clamp((rr - 300) / 900));
      c.beginPath();
      c.moveTo(Math.cos(r.a) * rr, Math.sin(r.a) * rr);
      c.lineTo(Math.cos(r.a) * (rr + r.l), Math.sin(r.a) * (rr + r.l));
      c.stroke();
    });
    c.restore();
    // hold on the first figure, then run it up to the second — landing where the narration says the
    // figure (land_at, seconds) when it is given, else at 74 % of the scene
    const L = S.land_at != null ? clamp(Number(S.land_at), .9, d - .3) : d * .74;
    const p = seg(t, Math.min(d * .28, L - .7), L);
    const v = lerp(parts.a, parts.b, eo3(p));
    parts.num.textContent = fmt(Math.round(v)) + parts.suf;
    const pop = seg(t, 0, .35);
    parts.num.style.opacity = pop;
    parts.num.style.filter = pop >= 1 ? 'none' : `blur(${(1 - pop) * 16}px)`;
    parts.num.style.transform = `scale(${lerp(1.3, 1, eo5(pop))})`;
    parts.unit.style.opacity = seg(t, .35, .75);
    parts.cap.style.opacity = seg(t, L - .05, L + .45) * .95;
    return;
  }

  if (T === 'board') {
    const P0 = parts, c = P0.c, FS = P0.FS, FAM = P0.FAM;
    // the beats, as fractions of however long the scene runs
    const t1 = d * .08, d1 = d * .22, t2 = d * .40, d2 = d * .21,
          tc = d * .59, t3 = d * .64, d3 = d * .19;
    const a = ss(seg(t, t1, t1 + d1)), b = P0.has2 ? ss(seg(t, t2, t2 + d2)) : 0;
    // smoothstep, not a cubic in-out: a cubic's peak speed is 3x its average and the move reads as a jump
    const cam = { x: P0.pan1 * a + (P0.CX - P0.pan1) * b, y: 90 * a + (P0.CY - 90) * b };
    const X = v => v - cam.x, Y = v => v - cam.y;
    c.clearRect(0, 0, W, H);
    boardGrid(c, cam);

    // the two cells the writing starts from; they fade once the line is under way
    const pink = 1 - eo3(seg(t, t1 + d1 * .55, t1 + d1 * .55 + d * .14));
    if (pink > .01) {
      const g = BRD.g;
      c.save(); c.globalAlpha = pink;
      c.fillStyle = PINK; c.globalAlpha = pink * .22;
      c.fillRect(X(BRD.dot.x - g * 1.5), Y(BRD.dot.y - g / 2), g, g);
      c.globalAlpha = pink; c.fillStyle = PINK;
      c.fillRect(X(BRD.dot.x - g * .5), Y(BRD.dot.y - g / 2), g, g);
      c.restore();
    }
    // the question in its box, on the leader line that points at that cell
    c.save(); c.lineWidth = 4.6; c.strokeStyle = '#000'; c.fillStyle = PAPER;
    c.fillRect(X(306), Y(442), P0.callW, BRD.callh);
    c.strokeRect(X(306), Y(442), P0.callW, BRD.callh);
    c.fillStyle = '#000'; c.font = `400 146px ${FAM}`; c.textBaseline = 'alphabetic';
    c.fillText(P0.call, X(306) + 50, Y(442) + 155);
    const sx = X(306) + 120, sy = Y(442) + BRD.callh, ey = Y(BRD.dot.y), ex = X(BRD.dot.x);
    c.beginPath(); c.moveTo(sx, sy); c.lineTo(sx, ey - 52);
    c.quadraticCurveTo(sx, ey, sx + 52, ey); c.lineTo(ex, ey); c.stroke();
    c.beginPath(); c.arc(ex, ey, BRD.dot.r, 0, 7); c.fill();
    c.restore();

    // the first line types at whatever rate fills its window
    const n1 = Math.floor(seg(t, t1, t1 + d1) * P0.l1.length);
    c.save(); c.fillStyle = '#000'; c.font = `400 ${FS}px ${FAM}`; c.textBaseline = 'alphabetic';
    c.fillText(P0.l1.slice(0, n1), X(BRD.l1x), Y(BRD.l1y));
    c.restore();

    if (P0.has2 && t >= tc) {
      // the chip opens sideways; the two corner marks (top right, bottom left) come after it
      const q = eo3(seg(t, tc, tc + .22));
      const bx = X(P0.CX + P0.x2 + 148), by = Y(P0.CY + P0.yc) - P0.chipH / 2, bw = P0.chipW * q;
      c.save();
      c.fillStyle = '#000'; c.fillRect(bx, by, bw, P0.chipH);
      c.font = `400 ${Math.round(FS * 1.30)}px ${FAM}`; c.textBaseline = 'alphabetic';
      if (q > .5) { c.fillStyle = '#fff'; c.fillText(P0.turn, bx + FS * .40, by + P0.chipH * .76); }
      if (q > .75) {
        const m = eo3((q - .75) / .25), ins = 12, arm = 27;
        c.strokeStyle = '#fff'; c.lineWidth = 4.6; c.lineCap = 'butt';
        c.beginPath();
        c.moveTo(bx + bw - ins - arm * m, by + ins); c.lineTo(bx + bw - ins, by + ins);
        c.lineTo(bx + bw - ins, by + ins + arm * m);
        c.moveTo(bx + ins + arm * m, by + P0.chipH - ins); c.lineTo(bx + ins, by + P0.chipH - ins);
        c.lineTo(bx + ins, by + P0.chipH - ins - arm * m);
        c.stroke();
      }
      c.restore();
      const n2 = Math.floor(seg(t, t3, t3 + d3) * P0.l2.length);
      boardLine(c, P0.l2.slice(0, n2), X(P0.CX + P0.x2), Y(P0.CY + P0.y2), FS, FAM);
    }
    return;
  }

  if (T === 'logo') {
    const p = seg(t, .15, 1.05);
    parts.lg.style.opacity = clamp(p * 1.6);
    parts.lg.style.filter = p >= 1 ? 'none' : `blur(${(1 - eo5(p)) * 18}px)`;
    parts.lg.style.transform = `scale(${lerp(1.09, 1, eback(p))})`;
    arrive(parts.ln, seg(t, .75, 1.45), { dy: 16, scale: 1 });
    parts.tag.style.opacity = seg(t, .05, .5);
    return;
  }

  if (T === 'post') {
    const p = seg(t, 0, .7);
    parts.card.style.opacity = clamp(p * 1.5);
    parts.card.style.transform = `translate3d(0,${(1 - eo5(p)) * 46}px,0) scale(${lerp(.97, 1, eo5(p))})`;
    parts.card.style.filter = p >= 1 ? 'none' : `blur(${(1 - p) * 8}px)`;
    parts.mks.forEach((m, i) => {
      const q = seg(t, 1.1 + i * .95, 1.45 + i * .95);
      m.style.background = q > 0 ? `rgba(255,255,255,${q})` : 'transparent';
      m.style.color = q > .45 ? '#000' : INK;
    });
    parts.bis.forEach((b, i) => arrive(b, seg(t, 1.5 + i * .3, 2.0 + i * .3), { dy: 14, scale: 1 }));
    return;
  }

  if (T === 'grid') {
    parts.tiles.forEach(tl => {
      const q = seg(t, .1 + tl.d * .5, 1.25 + tl.d * .5);
      const e = eo5(q);
      tl.el.style.opacity = clamp(q * 2);
      tl.el.style.transform = `translate3d(${(1 - e) * tl.fx}px,${(1 - e) * tl.fy}px,0) rotate(${(1 - e) * tl.fr}deg) scale(${lerp(.4, 1, e)})`;
    });
    arrive(parts.tt, seg(t, 1.5, 2.15), { dy: 18, scale: .97 });
    const sp = seg(t, 2.3, 2.9);
    parts.spare.style.opacity = clamp(sp * 2);
    parts.spare.style.transform = `translate3d(0,${(1 - eo5(sp)) * -60}px,0) scale(${lerp(.6, 1, eo5(sp))})`;
    arrive(parts.note, seg(t, 2.7, 3.3), { dy: 10, scale: 1 });
    return;
  }

  if (T === 'hud') {
    const p = seg(t, 0, .8);
    parts.win.style.opacity = clamp(p * 1.7);
    parts.win.style.transform = `scale(${lerp(.965, 1, eo5(p))})`;
    parts.wi.style.transform = `scale(${lerp(1.12, 1.0, eo3(seg(t, 0, d)))})`;   // a slow push the whole scene
    arrive(parts.panel, seg(t, .7, 1.3), { dy: 12, scale: .98 });
    // the identity types itself, line after line, like a system filling a field
    parts.p1.innerHTML = typed(parts.t1, (t - 1.0) * 26, '▌');
    parts.p2.innerHTML = typed(parts.t2, (t - 1.7) * 24, '▌');
    const a = seg(t, 1.9, 2.5);
    parts.arw.style.strokeDashoffset = parts.AL * (1 - eo3(a));
    parts.ah.style.opacity = a > .92 ? 1 : 0;
    parts.tks.forEach((k, i) => { k.style.opacity = seg(t, .5 + i * .011, .8 + i * .011) * .82; });
    arrive(parts.ctr, seg(t, 1.5, 2.1), { dy: 10, scale: .9 });
    return;
  }

  if (T === 'bigline') {
    parts.ws.forEach((w, i) => {
      const q = seg(t, .15 + i * .075, .15 + i * .075 + .5);
      w.style.opacity = clamp(q * 1.6);
      w.style.filter = q >= 1 ? 'none' : `blur(${(1 - eo5(q)) * 10}px)`;
      w.style.transform = `translate3d(0,${(1 - eo5(q)) * 30}px,0)`;
    });
    return;
  }

  if (T === 'typecard') {
    parts.tt.innerHTML = typed(parts.txt, (t - .25) * 21, '');
    const p = seg(t, 0, .3);
    parts.tt.style.opacity = p;
    arrive(parts.sb, seg(t, Math.max(.9, parts.txt.length / 21 + .35), Math.max(1.5, parts.txt.length / 21 + .95)), { dy: 12, scale: 1 });
    return;
  }

  if (T === 'spec') {
    arrive(parts.tt, seg(t, .05, .7), { dy: 16, scale: 1 });
    parts.cells.forEach((c, i) => {
      const q = seg(t, .5 + i * .22, 1.15 + i * .22);
      c.el.style.opacity = clamp(q * 1.7);
      c.el.style.transform = `translate3d(0,${(1 - eo5(q)) * 34}px,0) scale(${lerp(.95, 1, eback(q))})`;
      const r = seg(t, .7 + i * .22, 1.9 + i * .22);
      c.v.textContent = c.pre + count(c.to, r, c.dec) + c.suf;
    });
    return;
  }

  if (T === 'versus') {
    arrive(parts.ta, seg(t, .1, .75), { dy: 18, scale: .97 });
    arrive(parts.tb, seg(t, .22, .87), { dy: 18, scale: .97 });
    parts.vs.style.opacity = seg(t, .45, .9) * .9;
    parts.rows.forEach((r, i) => {
      const q = seg(t, .8 + i * .28, 1.4 + i * .28);
      r.el.style.opacity = clamp(q * 1.6);
      r.el.style.transform = `translate3d(0,${(1 - eo5(q)) * 26}px,0)`;
      const w = seg(t, 1.3 + i * .28, 1.75 + i * .28);
      // the winning cell lights; the other dims, so the eye is told where to look
      if (r.win === 'a' || r.win === 'b') {
        const win = r.win === 'a' ? r.ca : r.cb, lose = r.win === 'a' ? r.cb : r.ca;
        win.style.borderColor = w > 0 ? OR : '#2E2E34';
        win.style.boxShadow = w > 0 ? `0 0 ${26 * w}px rgba(255,109,36,${.3 * w})` : 'none';
        win.style.color = INK;
        lose.style.opacity = lerp(1, .45, w);
      }
    });
    return;
  }
}
