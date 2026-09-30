/* FOLIO — hud: every word on screen. Screen-space HTML (1920×1080), placed on its spoken word (`at`, shot
 * seconds — use S.at("phrase")). Things stay until the shot ends unless `until` is given. Sizes are the
 * reference's, measured at 1080p. Two faces only: EB Garamond (serif, old-style figures) and Nunito 800.
 *
 *  S.place(text, {at, sub, year, pos:"tr"|"tl", dark, until})       "Dayton, Ohio" + hairline rule (66 px), year above (82), sub-line (40)
 *  S.date(text, {at, sub, pos:"tl", dark, until})                    "December 17, 1903" (66) + a sub-line typed on (28): "10:35 a.m. · Kill Devil Hills"
 *  S.name(text, {target: P | [x,y], p:1, at, side:"above"|"left"|"right", dx, dy, until, size:48})   a person's name beside their head (follows them)
 *  S.name(text, {corner:"bl", at, until})                            lower-left name with a rule (61 px) — "Charlie Taylor"
 *  S.callout(text, {anchor:[x,y], p:1, box:[dx,dy] | {x,y}, at, until, dark})   cream label box + leader line + dot on the part ("cork")
 *  S.count({from, to, at, dur:1.4, x:1820, y:740, align:"right", label, size:110, decimals, prefix, suffix, color, labelColor, until})
 *                                   a number counting up (Nunito 800) with a serif line under it; x = the screen x of its
 *                                   aligned edge (right-aligned: where the number ENDS), y = its top
 *  S.stat(value, {unit, sub, at, x, y, size:184, align:"left", color, count})   "12 hp" with "about 180 lb" under it
 *  S.strike(word, {at, strikeAt, x, y, size:150, color, until})      big serif caps word, struck through in red at strikeAt
 *  S.write(word, {at, x, y, size:150, color, underline:"#3F7BBF", dur:0.6, until})   big serif word written on left→right, blue underline
 *  S.quote(text, {who, at, x, y, width:470, until})                  cream quote card: “Man will not fly for fifty years.” — Wilbur Wright, 1901
 *  S.chip({icon:"timer"|"ruler"|"none", text, count:{from,to,dur,suffix,decimals}, at, x, y, until})   cream pill (Nunito 800, 50 px)
 *  S.fig(n, {at, x:88, y:1000})                                      "Fig. 1" on a paper sheet
 *  S.title(main, {sub, at, until, color})                            end title: main (125 px, tracked) + rule with a diamond + spaced sub
 *  S.calendar({x, y, label:"WEEK", values:[3,4,6], times:[…], at, w:150})   tear-off calendar flipping to each value at its time
 *  S.card({x, y, w, h, at, rot:-2, until, draw:(g, w, h) => {}})    a small paper card popping in; draw into it (SVG, card units)
 *  S.barCard({bars:[{label, value, color, hatch}], title, note, at, x, y, w:400, h:270})   a card with a bar chart that grows
 *  S.label(text, {x, y, at, until, size:46, font:"serif"|"sans", color, align, shadow})     any other word on screen
 *  S.measure(L, {a:[x,y], b:[x,y], text, at, color, offset})          a dimension line in the world with a chip ("120 ft")
 * Every function returns the element; `el.hide(t)` fades it out from time t.
 */
(function () {
  "use strict";
  const F = window.FOLIO;
  const W = F.W, H = F.H;
  const LIGHT = "#F8F6EA", DARK = "#3A2E24", SHADOW = "0 2px 10px rgba(0,0,0,.34), 0 0 2px rgba(0,0,0,.22)";

  F.plugins.push((S) => {
    const div = (css, html = "", cls = "") => {
      const d = S.div("hud", cls, html);
      Object.assign(d.style, { whiteSpace: "nowrap" }, css || {});
      return d;
    };
    const px = (v) => `${Math.round(v)}px`;
    const fmt = (v, dec = 0) => {
      const s = Math.abs(v).toFixed(dec), [i, f] = s.split(".");
      return (v < 0 ? "−" : "") + i.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (f ? "." + f : "");
    };
    // enter: fade + rise of `rise` px over 0.5 s; leave: fade over 0.35 s from `until`
    const life = (el, at, until, rise = 10, dur = 0.5) => {
      let hideAt = until ?? null;
      el.hide = (t) => { hideAt = t; return el; };
      el.style.opacity = 0;
      const base = el.style.transform || "";
      S.on((t) => {
        const a = F.eOut(F.seg(t, at, at + dur));
        const b = hideAt == null ? 1 : 1 - F.smooth(F.seg(t, hideAt, hideAt + 0.35));
        el.style.opacity = (a * b).toFixed(3);
        const dy = Math.round((1 - a) * rise);
        el.style.transform = (base + (dy ? ` translateY(${dy}px)` : "")).trim();
      });
      return el;
    };
    // the real rendered width (old-style figures, kerning and letter-spacing included — a canvas cannot apply them)
    const measure = (text, font, ls = "") => {
      const sans = /Nunito/.test(font), size = parseFloat(font.match(/(\d+(?:\.\d+)?)px/)[1]);
      const sp = document.createElement("span");
      sp.className = sans ? "sans" : "serif";
      Object.assign(sp.style, { position: "absolute", visibility: "hidden", whiteSpace: "nowrap", fontSize: size + "px",
                                letterSpacing: ls, left: "-9999px", top: "0" });
      if (sans) sp.style.fontWeight = (font.match(/^(\d00)/) || [0, "800"])[1];
      sp.textContent = text;
      document.body.appendChild(sp);
      const w = sp.getBoundingClientRect().width;
      sp.remove();
      return w;
    };

    // ── place / date ─────────────────────────────────────────────────────────────
    function titleBlock(text, o, kind) {
      const at = o.at ?? 0.3, dark = !!o.dark, col = o.color || (dark ? DARK : LIGHT);
      const right = (o.pos || (kind === "place" ? "tr" : "tl")) === "tr";
      const box = div({ top: px(o.y ?? 52), [right ? "right" : "left"]: px(o.x ?? 84), textAlign: right ? "right" : "left",
                        color: col, textShadow: dark ? "none" : SHADOW });
      const tsize = o.size ?? 66;
      if (o.year) {
        const y = document.createElement("div"); y.className = "serif"; y.textContent = o.year;
        Object.assign(y.style, { fontSize: px(o.yearSize ?? 82), lineHeight: "1", marginBottom: "2px" });
        box.appendChild(y); life(y, at, o.until, 8);
      }
      const main = document.createElement("div"); main.className = "serif"; main.textContent = text;
      Object.assign(main.style, { fontSize: px(tsize), lineHeight: "1.05", display: "inline-block" });
      box.appendChild(main); life(main, at + (o.year ? 0.12 : 0), o.until, 10);
      if (o.rule !== false) {
        const r = document.createElement("div");
        const w = measure(text, `400 ${tsize}px "EB Garamond"`);
        Object.assign(r.style, { height: "2px", width: px(w), background: col, opacity: 0.85, marginTop: "4px",
                                 marginLeft: right ? "auto" : "0", transformOrigin: right ? "100% 50%" : "0 50%",
                                 boxShadow: dark ? "none" : "0 1px 4px rgba(0,0,0,.3)" });
        box.appendChild(r);
        const t0 = at + 0.25;
        let hideAt = o.until ?? null;
        S.on((t) => {
          const p = F.smooth(F.seg(t, t0, t0 + 0.6)), b = hideAt == null ? 1 : 1 - F.smooth(F.seg(t, hideAt, hideAt + 0.35));
          r.style.transform = `scaleX(${p.toFixed(4)})`; r.style.opacity = (0.85 * b).toFixed(3);
        });
      }
      if (o.sub) {
        const s = document.createElement("div"); s.className = "serif";
        Object.assign(s.style, { fontSize: px(o.subSize ?? (kind === "date" ? 28 : 40)), lineHeight: "1.2", marginTop: "8px",
                                 opacity: 0.95 });
        box.appendChild(s);
        if (kind === "date") {
          // typed on, one character at a time
          const full = o.sub, t0 = at + 0.7, cps = 26;
          s.textContent = full; s.style.visibility = "hidden";
          const shown = document.createElement("span"); s.textContent = ""; s.appendChild(shown);
          const ghost = document.createElement("span"); ghost.style.visibility = "hidden"; ghost.textContent = full; s.appendChild(ghost);
          s.style.visibility = "visible";
          let last = -1;
          S.on((t) => {
            const n = Math.max(0, Math.min(full.length, Math.floor((t - t0) * cps)));
            if (n !== last) { shown.textContent = full.slice(0, n); ghost.textContent = full.slice(n); last = n; }
            s.style.opacity = o.until != null ? (1 - F.smooth(F.seg(t, o.until, o.until + 0.35))).toFixed(3) : "";
          });
        } else {
          s.textContent = o.sub; life(s, at + 0.45, o.until, 8);
        }
      }
      box.hide = (t) => { o.until = t; return box; };
      return box;
    }
    S.place = (text, o = {}) => titleBlock(text, o, "place");
    S.date = (text, o = {}) => titleBlock(text, o, "date");

    // ── names ────────────────────────────────────────────────────────────────────
    S.name = (text, o = {}) => {
      const at = o.at ?? 0.4;
      if (o.corner) {
        const size = o.size ?? 61;
        const d = div({ left: px(o.x ?? 86), bottom: px(o.y ?? 150), color: o.color || LIGHT, textShadow: SHADOW });
        const m = document.createElement("div"); m.className = "serif"; m.textContent = text;
        Object.assign(m.style, { fontSize: px(size), lineHeight: "1.05" }); d.appendChild(m);
        const r = document.createElement("div");
        Object.assign(r.style, { height: "2px", width: px(measure(text, `400 ${size}px "EB Garamond"`)), background: o.color || LIGHT,
                                 marginTop: "5px", transformOrigin: "0 50%", boxShadow: "0 1px 4px rgba(0,0,0,.3)" });
        d.appendChild(r);
        S.on((t) => { r.style.transform = `scaleX(${F.smooth(F.seg(t, at + 0.2, at + 0.8)).toFixed(4)})`; });
        return life(d, at, o.until, 10);
      }
      const size = o.size ?? 48, side = o.side || "above", p = o.p ?? 1;
      const d = div({ color: o.color || LIGHT, textShadow: SHADOW, fontSize: px(size), lineHeight: "1" }, "", "serif");
      d.textContent = text;
      const w = measure(text, `400 ${size}px "EB Garamond"`);
      const pt = (t) => {
        const tg = o.target;
        let wx, wy;
        if (Array.isArray(tg)) [wx, wy] = tg;
        else if (tg && tg.headAt) [wx, wy] = tg.headAt(t);
        else [wx, wy] = [960, 300];
        const [sx, sy] = F.toScreen(wx, wy, p);
        return [sx, sy];
      };
      S.on((t) => {
        const [sx, sy] = pt(t);
        let x = sx - w / 2, y = sy - size - 18;
        if (side === "left") { x = sx - w - 36; y = sy + 10; }
        if (side === "right") { x = sx + 36; y = sy + 10; }
        d.style.left = px(x + (o.dx || 0)); d.style.top = px(y + (o.dy || 0));
      });
      return life(d, at, o.until, 6);
    };

    // ── callout ──────────────────────────────────────────────────────────────────
    const lineSvg = () => {
      const s = F.el("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}` });
      Object.assign(s.style, { position: "absolute", left: 0, top: 0, overflow: "visible" });
      S.hud.appendChild(s); return s;
    };
    S.callout = (text, o = {}) => {
      const at = o.at ?? 0.5, p = o.p ?? 1, size = o.size ?? 46, dark = !!o.dark;
      const svg = lineSvg();
      const lineCol = o.lineColor || (dark ? "#5A4A3A" : "#F4EEDC");
      const ln = F.el("line", { stroke: lineCol, "stroke-width": 2.2, "stroke-linecap": "round",
                                style: dark ? "" : "filter: drop-shadow(0 1px 2px rgba(0,0,0,.35))" }, svg);
      const dot = F.el("circle", { r: 5.5, fill: lineCol, stroke: dark ? "#F4EEDC" : "rgba(60,40,20,.55)", "stroke-width": 1.5 }, svg);
      const box = div({ background: o.fill || "rgba(239,232,214,.95)", color: DARK, fontSize: px(size), lineHeight: "1.05",
                        padding: "3px 16px 7px", borderRadius: "5px", boxShadow: "0 3px 12px rgba(30,20,10,.28)" }, "", "serif");
      box.textContent = text;
      const bw = measure(text, `400 ${size}px "EB Garamond"`) + 32, bh = size * 1.05 + 10;
      let hideAt = o.until ?? null;
      box.hide = (t) => { hideAt = t; return box; };
      S.on((t) => {
        const [ax, ay] = F.toScreen(o.anchor ? o.anchor[0] : 960, o.anchor ? o.anchor[1] : 540, p);
        let bx, by;
        if (o.box && !Array.isArray(o.box)) { bx = o.box.x; by = o.box.y; }
        else { const [dx, dy] = o.box || [90, -110]; bx = ax + dx - (dx < 0 ? bw : 0); by = ay + dy - bh / 2; }
        // the leader meets the box at its nearest vertical edge, half-way down
        const ex = ax < bx ? bx : ax > bx + bw ? bx + bw : bx + bw / 2, ey = by + bh / 2;
        const pl = F.eOut(F.seg(t, at, at + 0.35));
        const fade = hideAt == null ? 1 : 1 - F.smooth(F.seg(t, hideAt, hideAt + 0.35));
        ln.setAttribute("x1", ax); ln.setAttribute("y1", ay);
        ln.setAttribute("x2", F.lerp(ax, ex, pl)); ln.setAttribute("y2", F.lerp(ay, ey, pl));
        ln.setAttribute("opacity", (pl > 0 ? 1 : 0) * fade);
        dot.setAttribute("cx", ax); dot.setAttribute("cy", ay);
        dot.setAttribute("opacity", F.eOut(F.seg(t, at - 0.05, at + 0.15)) * fade);
        const pb = F.eOut(F.seg(t, at + 0.25, at + 0.6));
        box.style.left = px(bx); box.style.top = px(by + (1 - pb) * 6);
        box.style.opacity = (pb * fade).toFixed(3);
      });
      box.style.opacity = 0;
      return box;
    };

    // ── numbers ──────────────────────────────────────────────────────────────────
    S.count = (o = {}) => {
      const at = o.at ?? 0.3, dur = o.dur ?? 1.4, size = o.size ?? 110, align = o.align || "right";
      const from = o.from ?? 0, to = o.to ?? 100, dec = o.decimals ?? 0;
      const d = div({ textAlign: align, color: o.color || "#FFFFFF" });
      // x is where the number's aligned edge sits on screen (right-aligned: its right edge; a value under 960 is
      // read as the margin from the right edge, as in the early examples)
      if (align === "right") { const x = o.x ?? 1820; d.style.right = px(x >= 960 ? W - x : x); }
      else d.style.left = px(o.x ?? 100);
      d.style.top = px(o.y ?? 740);
      const n = document.createElement("div"); n.className = "sans";
      Object.assign(n.style, { fontSize: px(size), lineHeight: "1", textShadow: "0 3px 14px rgba(20,40,70,.28), 0 0 2px rgba(0,0,0,.18)",
                               letterSpacing: "0.005em" });
      d.appendChild(n);
      if (o.label) {
        const l = document.createElement("div"); l.className = "serif"; l.textContent = o.label;
        Object.assign(l.style, { fontSize: px(o.labelSize ?? 42), color: o.labelColor || "#3A4A5E", marginTop: "2px", lineHeight: "1.1" });
        d.appendChild(l); life(l, at + 0.25, o.until, 6);
      }
      let last = "";
      const end = Math.max(at + 0.3, Math.min(at + dur, S.dur - 0.45));      // the number always lands before the cut
      S.on((t) => {
        const v = F.lerp(from, to, F.eOut5(F.seg(t, at, end)));
        const s = (o.prefix || "") + fmt(dec ? v : Math.round(v), dec) + (o.suffix || "");
        if (s !== last) { n.textContent = s; last = s; }
      });
      life(n, at, o.until, 8, 0.35);
      d.hide = (t) => { o.until = t; n.hide(t); return d; };
      return d;
    };

    S.stat = (value, o = {}) => {
      const at = o.at ?? 0.3, size = o.size ?? 184, align = o.align || "left";
      const d = div({ left: px(o.x ?? 1100), top: px(o.y ?? 300), textAlign: align === "center" ? "center" : align,
                      color: o.color || "#F6EEDD" });
      if (align === "center") d.style.transform = "translateX(-50%)";
      const n = document.createElement("div"); n.className = "sans";
      Object.assign(n.style, { fontSize: px(size), lineHeight: "0.95", textShadow: "0 4px 18px rgba(40,20,10,.35)" });
      const num = document.createElement("span"); n.appendChild(num);
      if (o.unit) { const u = document.createElement("span"); u.textContent = " " + o.unit; n.appendChild(u); }
      d.appendChild(n);
      const target = parseFloat(String(value).replace(/,/g, ""));
      if (o.count && isFinite(target)) {
        const dec = (String(value).split(".")[1] || "").length;
        const end = Math.max(at + 0.3, Math.min(at + (o.dur ?? 1.2), S.dur - 0.45));
        S.on((t) => { num.textContent = fmt(F.lerp(0, target, F.eOut5(F.seg(t, at, end))), dec); });
      } else num.textContent = String(value);
      if (o.sub) {
        const s = document.createElement("div"); s.className = "serif"; s.textContent = o.sub;
        Object.assign(s.style, { fontSize: px(o.subSize ?? 46), color: o.subColor || "#EBDDC5", opacity: 0.9, textAlign: "center",
                                 marginTop: "6px", textShadow: "0 2px 8px rgba(0,0,0,.3)" });
        d.appendChild(s); life(s, at + 0.35, o.until, 6);
      }
      life(n, at, o.until, 12);
      return d;
    };

    // ── words on paper ───────────────────────────────────────────────────────────
    S.strike = (word, o = {}) => {
      const at = o.at ?? 0.3, sAt = o.strikeAt ?? at + 0.9, size = o.size ?? 150;
      const d = div({ left: px(o.x ?? 1100), top: px(o.y ?? 240), color: o.color || "#8C7B6B", fontSize: px(size), lineHeight: "1",
                      letterSpacing: "0.02em" }, "", "serif");
      d.textContent = word.toUpperCase();
      const w = measure(word.toUpperCase(), `400 ${size}px "EB Garamond"`, "0.02em") + size * 0.2;
      const svg = F.el("svg", { width: w + 60, height: size, viewBox: `0 0 ${w + 60} ${size}` });
      Object.assign(svg.style, { position: "absolute", left: px(-size * 0.12), top: 0, overflow: "visible" });
      d.appendChild(svg);
      const y = size * 0.52;
      const path = F.el("path", { d: `M0 ${y + 3} C ${w * 0.3} ${y - 2}, ${w * 0.7} ${y + 1}, ${w + 30} ${y - 3}`, fill: "none",
                                  stroke: o.strikeColor || "#C13A29", "stroke-width": Math.max(4, size * 0.045), "stroke-linecap": "round" }, svg);
      S.on((t) => {
        const L = path.getTotalLength(), p = F.eOut(F.seg(t, sAt, sAt + 0.35));
        path.setAttribute("stroke-dasharray", `${L} ${L}`); path.setAttribute("stroke-dashoffset", (L * (1 - p)).toFixed(1));
        d.style.color = F.mix(o.color || "#8C7B6B", "#CFC3AC", 0.5 * F.seg(t, sAt + 0.2, sAt + 0.8));
      });
      return life(d, at, o.until, 10);
    };

    S.write = (word, o = {}) => {
      const at = o.at ?? 0.3, size = o.size ?? 150, dur = o.dur ?? 0.6;
      const d = div({ left: px(o.x ?? 1100), top: px(o.y ?? 420), color: o.color || "#563B2A", fontSize: px(size), lineHeight: "1",
                      letterSpacing: "0.02em" }, "", "serif");
      const txt = o.upper === false ? word : word.toUpperCase();
      d.textContent = txt;
      const w = measure(txt, `400 ${size}px "EB Garamond"`, "0.02em");
      let ul = null;
      if (o.underline !== false) {
        const svg = F.el("svg", { width: w + 40, height: 30, viewBox: `0 0 ${w + 40} 30` });
        Object.assign(svg.style, { position: "absolute", left: 0, top: px(size * 1.04), overflow: "visible" });
        d.appendChild(svg);
        ul = F.el("path", { d: `M4 8 C ${w * 0.35} 14, ${w * 0.7} 4, ${w + 10} 10`, fill: "none", stroke: o.underline || "#3F7BBF",
                            "stroke-width": Math.max(3, size * 0.028), "stroke-linecap": "round" }, svg);
      }
      S.on((t) => {
        const p = F.smooth(F.seg(t, at, at + dur));
        d.style.clipPath = `inset(-20% ${((1 - p) * 100).toFixed(2)}% -40% -5%)`;
        d.style.opacity = p > 0 ? 1 : 0;
        if (ul) {
          const L = ul.getTotalLength(), q = F.eOut(F.seg(t, at + dur * 0.8, at + dur * 0.8 + 0.45));
          ul.setAttribute("stroke-dasharray", `${L} ${L}`); ul.setAttribute("stroke-dashoffset", (L * (1 - q)).toFixed(1));
        }
        if (o.until != null) d.style.opacity = (1 - F.smooth(F.seg(t, o.until, o.until + 0.35))).toFixed(3);
      });
      return d;
    };

    // ── cards ────────────────────────────────────────────────────────────────────
    S.quote = (text, o = {}) => {
      const at = o.at ?? 0.5, width = o.width ?? 470;
      const d = div({ width: px(width), whiteSpace: "normal", background: "#F1EBD7", border: "1px solid #D8CDB2",
                      boxShadow: "0 10px 26px rgba(30,20,10,.30), 0 1px 3px rgba(30,20,10,.2)", padding: "26px 34px 22px",
                      color: DARK });
      if (o.x != null) d.style.left = px(o.x); else d.style.right = px(o.right ?? 70);
      if (o.y != null) d.style.top = px(o.y); else d.style.bottom = px(o.bottom ?? 110);
      const q = document.createElement("div"); q.className = "serif";
      Object.assign(q.style, { fontSize: px(o.size ?? 50), lineHeight: "1.12", textIndent: "-0.35em" });
      q.textContent = `“${text.replace(/^["“]|["”]$/g, "")}”`;
      d.appendChild(q);
      if (o.who) {
        const w = document.createElement("div"); w.className = "serif"; w.textContent = "— " + o.who;
        Object.assign(w.style, { fontSize: px(o.whoSize ?? 28), color: "#8B8070", marginTop: "14px" });
        d.appendChild(w);
      }
      return life(d, at, o.until, 16, 0.55);
    };

    const ICON = {
      timer: (p) => `<svg width="46" height="46" viewBox="0 0 46 46" style="vertical-align:-7px;margin-right:10px">
        <rect x="19" y="1" width="8" height="5" rx="1.5" fill="#2E2A26"/><circle cx="23" cy="26" r="17.5" fill="#FBF7EC" stroke="#2E2A26" stroke-width="3.2"/>
        <path d="${pie(23, 26, 14.5, p)}" fill="#5B82B3"/><circle cx="23" cy="26" r="2.2" fill="#2E2A26"/></svg>`,
      ruler: () => `<svg width="50" height="46" viewBox="0 0 50 46" style="vertical-align:-8px;margin-right:10px">
        <rect x="3" y="14" width="44" height="18" rx="3" fill="#FBF7EC" stroke="#2E2A26" stroke-width="3"/>
        ${[11, 19, 27, 35].map((x, i) => `<line x1="${x}" y1="14" x2="${x}" y2="${i % 2 ? 22 : 26}" stroke="#2E2A26" stroke-width="2.4"/>`).join("")}</svg>`,
    };
    function pie(cx, cy, r, p) {
      p = F.clamp(p, 0, 0.9999); if (p <= 0) return "";
      const a = -Math.PI / 2 + p * Math.PI * 2, large = p > 0.5 ? 1 : 0;
      return `M${cx} ${cy} L${cx} ${cy - r} A${r} ${r} 0 ${large} 1 ${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)} Z`;
    }
    const c_at = (o) => (o.count && o.count.at != null ? o.count.at : o.at ?? 0.3);
    S.chip = (o = {}) => {
      const at = o.at ?? 0.3, size = o.size ?? 50;
      const d = div({ left: px(o.x ?? 86), top: px(o.y ?? 940), background: "#F2EAD8", color: "#2E2A26", borderRadius: px(size * 0.34),
                      padding: `${Math.round(size * 0.12)}px ${Math.round(size * 0.36)}px ${Math.round(size * 0.14)}px`,
                      fontSize: px(size), lineHeight: "1", boxShadow: "0 3px 12px rgba(0,0,0,.20)" }, "", "sans");
      const icon = document.createElement("span"); d.appendChild(icon);
      const txt = document.createElement("span"); d.appendChild(txt);
      let last = "";
      S.on((t) => {
        let s = o.text || "", prog = 1;
        if (o.count) {
          const c0 = c_at(o), p = F.seg(t, c0, Math.max(c0 + 0.3, Math.min(c0 + (o.count.dur ?? 1.5), S.dur - 0.45)));
          const c = o.count, e = c.linear ? p : F.eOut(p);
          const v = F.lerp(c.from ?? 0, c.to ?? 0, e);
          s = (c.prefix || "") + fmt(c.decimals ? v : Math.floor(v + 1e-6), c.decimals || 0) + (c.suffix || "");
          prog = c.pie != null ? c.pie : e;
        }
        const key = s + "|" + prog.toFixed(3);
        if (key !== last) {
          last = key; txt.textContent = s;
          icon.innerHTML = o.icon && ICON[o.icon] ? ICON[o.icon](o.timer ? F.lerp(o.timer.from ?? 0, o.timer.to ?? 1, prog) : prog) : "";
        }
      });
      return life(d, at, o.until, 8, 0.4);
    };

    S.fig = (n, o = {}) => {
      const d = div({ left: px(o.x ?? 88), top: px(o.y ?? 990), color: o.color || "#A89A80", fontSize: px(o.size ?? 41) }, "", "serif");
      d.textContent = typeof n === "number" ? `Fig. ${n}` : String(n);
      return life(d, o.at ?? 0.4, o.until, 0);
    };

    S.label = (text, o = {}) => {
      const sans = o.font === "sans", size = o.size ?? (sans ? 47 : 46);
      const d = div({ color: o.color || (sans ? "#3F627C" : LIGHT), fontSize: px(size), lineHeight: "1.05",
                      textShadow: o.shadow === false || sans ? "none" : SHADOW }, "", sans ? "sans" : "serif");
      d.textContent = sans && o.upper !== false ? text.toUpperCase() : text;
      const w = measure(d.textContent, `${sans ? 800 : 400} ${size}px "${sans ? "Nunito" : "EB Garamond"}"`);
      const x = o.x ?? 960, align = o.align || "left";
      d.style.left = px(align === "center" ? x - w / 2 : align === "right" ? x - w : x);
      d.style.top = px(o.y ?? 540);
      return life(d, o.at ?? 0.3, o.until, o.rise ?? 8);
    };

    S.title = (main, o = {}) => {
      const at = o.at ?? 0.6, col = o.color || "#F3ECDD", size = o.size ?? 125;
      const shade = div({ left: 0, top: 0, width: px(W), height: px(H),
                          background: "linear-gradient(to bottom, rgba(0,0,0,0) 45%, rgba(10,8,6,.55) 100%)" });
      life(shade, at - 0.3, o.until, 0, 0.9);
      const d = div({ left: 0, width: px(W), bottom: px(o.bottom ?? 70), textAlign: "center", color: col,
                      textShadow: "0 2px 16px rgba(0,0,0,.45)" });
      const m = document.createElement("div"); m.className = "serif"; m.textContent = main;
      Object.assign(m.style, { fontSize: px(size), lineHeight: "1", letterSpacing: "0.03em" });
      d.appendChild(m); life(m, at, o.until, 14, 0.8);
      const tw = measure(main, `400 ${size}px "EB Garamond"`, "0.03em") * 0.92;
      const rule = F.el("svg", { width: tw + 40, height: 24, viewBox: `0 0 ${tw + 40} 24` });
      Object.assign(rule.style, { display: "block", margin: "14px auto 10px", overflow: "visible" });
      d.appendChild(rule);
      const cx = (tw + 40) / 2;
      const l1 = F.el("line", { x1: cx - 14, y1: 12, x2: 20, y2: 12, stroke: col, "stroke-width": 2 }, rule);
      const l2 = F.el("line", { x1: cx + 14, y1: 12, x2: tw + 20, y2: 12, stroke: col, "stroke-width": 2 }, rule);
      const dm = F.el("path", { d: `M${cx} 5 L${cx + 7} 12 L${cx} 19 L${cx - 7} 12Z`, fill: col }, rule);
      S.on((t) => {
        const p = F.smooth(F.seg(t, at + 0.35, at + 1.1)), f = o.until == null ? 1 : 1 - F.smooth(F.seg(t, o.until, o.until + 0.35));
        const half = (tw / 2 - 6) * p;
        l1.setAttribute("x2", (cx - 14 - half).toFixed(1)); l2.setAttribute("x2", (cx + 14 + half).toFixed(1));
        rule.style.opacity = (F.seg(t, at + 0.3, at + 0.5) * f).toFixed(3);
        dm.setAttribute("opacity", F.eOut(F.seg(t, at + 0.3, at + 0.6)).toFixed(3));
      });
      if (o.sub) {
        const s = document.createElement("div"); s.className = "serif"; s.textContent = o.sub;
        Object.assign(s.style, { fontSize: px(o.subSize ?? 63), letterSpacing: "0.3em", marginRight: "-0.3em", lineHeight: "1" });
        d.appendChild(s); life(s, at + 0.8, o.until, 8, 0.8);
      }
      return d;
    };

    S.calendar = (o = {}) => {
      const at = o.at ?? 0.3, w = o.w ?? 150, h = w * 1.05, vals = o.values || [1], times = o.times || [at];
      const d = div({ left: px(o.x ?? 1300), top: px(o.y ?? 180), width: px(w), height: px(h), perspective: "600px" });
      const head = document.createElement("div"); head.className = "sans"; head.textContent = o.label || "WEEK";
      Object.assign(head.style, { position: "absolute", left: 0, top: 0, width: px(w), height: px(w * 0.26), background: "#B8433A",
                                  color: "#FFF", fontSize: px(w * 0.17), lineHeight: px(w * 0.27), textAlign: "center",
                                  borderRadius: "3px 3px 0 0", boxShadow: "0 3px 10px rgba(0,0,0,.25)", zIndex: 3 });
      d.appendChild(head);
      const pages = vals.map((v, i) => {
        const pg = document.createElement("div"); pg.className = "sans"; pg.textContent = v;
        Object.assign(pg.style, { position: "absolute", left: 0, top: px(w * 0.26), width: px(w), height: px(h - w * 0.26),
                                  background: "#FBF8F0", color: "#2B2622", fontSize: px(w * 0.62), lineHeight: px(h - w * 0.26),
                                  textAlign: "center", transformOrigin: "50% 0", boxShadow: "0 6px 14px rgba(0,0,0,.22)",
                                  zIndex: 2 + (vals.length - i) / 100 });
        d.appendChild(pg); return pg;
      });
      S.on((t) => {
        pages.forEach((pg, i) => {
          const next = times[i + 1];
          const f = next == null ? 0 : F.eIn(F.seg(t, next - 0.3, next));
          pg.style.transform = f > 0 ? `rotateX(${(f * 100).toFixed(1)}deg)` : "";
          pg.style.opacity = (t >= (times[i] ?? at) - 0.01 ? 1 : 0) * (1 - F.seg(f, 0.7, 1));
        });
      });
      return life(d, at, o.until, 10);
    };

    S.card = (o = {}) => {
      const at = o.at ?? 0.4, w = o.w ?? 400, h = o.h ?? 270;
      const d = div({ left: px(o.x ?? 1400), top: px(o.y ?? 90), width: px(w), height: px(h), background: "#F4EEDF",
                      backgroundImage: "linear-gradient(rgba(120,100,70,.10) 1px, transparent 1px), linear-gradient(90deg, rgba(120,100,70,.10) 1px, transparent 1px)",
                      backgroundSize: "20px 20px", boxShadow: "0 10px 24px rgba(30,20,10,.32), 0 1px 3px rgba(30,20,10,.2)",
                      transformOrigin: "50% 60%" });
      const svg = F.el("svg", { width: w, height: h, viewBox: `0 0 ${w} ${h}` });
      svg.style.position = "absolute"; svg.style.overflow = "visible"; d.appendChild(svg);
      const g = F.el("g", null, svg);
      if (o.draw) o.draw(g, w, h, svg);
      const rot = o.rot ?? -2;
      d.style.opacity = 0;
      S.on((t) => {
        const p = F.seg(t, at, at + 0.45), e = F.eBack(p, 1.6);
        const f = o.until == null ? 1 : 1 - F.smooth(F.seg(t, o.until, o.until + 0.35));
        d.style.opacity = (F.eOut(p) * f).toFixed(3);
        d.style.transform = `rotate(${rot}deg) scale(${(0.9 + 0.1 * e).toFixed(4)})`;
      });
      return d;
    };

    S.barCard = (o = {}) => {
      const at = o.at ?? 0.4, bars = o.bars || [];
      const max = o.max ?? Math.max(...bars.map((b) => b.value), 1);
      return S.card(Object.assign({}, o, { draw: (g, w, h) => {
        const x0 = 58, y0 = h - 58, top = 34, bw = Math.min(110, (w - x0 - 30) / bars.length - 26);
        F.el("line", { x1: x0, y1: top - 6, x2: x0, y2: y0, stroke: "#3A2E24", "stroke-width": 2.5 }, g);
        F.el("line", { x1: x0, y1: y0, x2: w - 20, y2: y0, stroke: "#3A2E24", "stroke-width": 2.5 }, g);
        if (o.axis) F.el("text", { x: 26, y: (top + y0) / 2, "font-family": "Nunito", "font-weight": 800, "font-size": 16, fill: "#3A2E24",
                                   transform: `rotate(-90 26 ${(top + y0) / 2})`, "text-anchor": "middle", text: o.axis }, g);
        const hatchId = F.uid("hatch");
        const pat = F.el("pattern", { id: hatchId, width: 8, height: 8, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" }, g);
        F.el("line", { x1: 0, y1: 0, x2: 0, y2: 8, stroke: "#3A2E24", "stroke-width": 1.6, opacity: 0.55 }, pat);
        bars.forEach((b, i) => {
          const x = x0 + 26 + i * (bw + 26), full = ((y0 - top) * b.value) / max;
          const r = F.el("rect", { x, width: bw, y: y0, height: 0, fill: b.hatch ? `url(#${hatchId})` : b.color || "#3F7BBF",
                                   stroke: b.hatch ? "#3A2E24" : "none", "stroke-width": 2, "stroke-dasharray": b.hatch ? "6 4" : "none" }, g);
          F.el("text", { x: x + bw / 2, y: y0 + 24, "text-anchor": "middle", "font-family": "Nunito", "font-weight": 800, "font-size": 17,
                         fill: "#3A2E24", text: b.label || "" }, g);
          if (b.note) F.el("text", { x: x + bw / 2, y: y0 + 42, "text-anchor": "middle", "font-family": "EB Garamond", "font-size": 14,
                                     fill: "#6B5E50", text: b.note }, g);
          const tb = at + 0.35 + i * 0.35;
          S.on((t) => { const p = F.eOut(F.seg(t, tb, tb + 0.7)); r.setAttribute("y", (y0 - full * p).toFixed(1)); r.setAttribute("height", (full * p).toFixed(1)); });
          if (b.tag) {
            const tx = F.el("text", { x: x + bw + 8, y: y0 - full + 4, "font-family": "Nunito", "font-weight": 800, "font-size": 20,
                                      fill: b.color || "#3F7BBF", text: b.tag, opacity: 0 }, g);
            S.on((t) => tx.setAttribute("opacity", F.seg(t, tb + 0.7, tb + 1.0).toFixed(3)));
          }
        });
        if (o.title) F.el("text", { x: w / 2, y: 24, "text-anchor": "middle", "font-family": "EB Garamond", "font-size": 22, fill: "#3A2E24", text: o.title }, g);
      } }));
    };

    // ── measured things in the world ─────────────────────────────────────────────
    S.measure = (L, o = {}) => {
      const [ax, ay] = o.a || [600, 800], [bx, by] = o.b || [1300, 800], at = o.at ?? 0.4, col = o.color || "#2E2A26";
      const g = F.el("g", { opacity: 0 }, L.g);
      const ang = Math.atan2(by - ay, bx - ax), nx = -Math.sin(ang) * 16, ny = Math.cos(ang) * 16;
      const mx = (ax + bx) / 2, my = (ay + by) / 2;
      const l1 = F.el("line", { stroke: col, "stroke-width": 3, "stroke-linecap": "round" }, g);
      const l2 = F.el("line", { stroke: col, "stroke-width": 3, "stroke-linecap": "round" }, g);
      const t1 = F.el("line", { x1: ax - nx, y1: ay - ny, x2: ax + nx, y2: ay + ny, stroke: col, "stroke-width": 3 }, g);
      const t2 = F.el("line", { x1: bx - nx, y1: by - ny, x2: bx + nx, y2: by + ny, stroke: col, "stroke-width": 3 }, g);
      const size = o.size ?? 30, tw = measure(o.text || "", `800 ${size}px Nunito`) + size * 0.8;
      const chip = F.el("g", { transform: `translate(${mx} ${my})` }, g);
      F.el("rect", { x: -tw / 2, y: -size * 0.72, width: tw, height: size * 1.44, rx: size * 0.36, fill: "#F2EAD8",
                     style: "filter: drop-shadow(0 2px 4px rgba(0,0,0,.25))" }, chip);
      F.el("text", { x: 0, y: size * 0.34, "text-anchor": "middle", "font-family": "Nunito", "font-weight": 800, "font-size": size,
                     fill: "#2E2A26", text: o.text || "" }, chip);
      S.on((t) => {
        const p = F.smooth(F.seg(t, at, at + 0.6)), f = o.until == null ? 1 : 1 - F.smooth(F.seg(t, o.until, o.until + 0.35));
        g.setAttribute("opacity", ((p > 0 ? 1 : 0) * f).toFixed(3));
        l1.setAttribute("x1", mx); l1.setAttribute("y1", my); l1.setAttribute("x2", F.lerp(mx, ax, p)); l1.setAttribute("y2", F.lerp(my, ay, p));
        l2.setAttribute("x1", mx); l2.setAttribute("y1", my); l2.setAttribute("x2", F.lerp(mx, bx, p)); l2.setAttribute("y2", F.lerp(my, by, p));
        const tk = F.seg(t, at + 0.45, at + 0.65); t1.setAttribute("opacity", tk); t2.setAttribute("opacity", tk);
        chip.setAttribute("opacity", F.eOut(F.seg(t, at + 0.2, at + 0.5)).toFixed(3));
      });
      return g;
    };
  });
})();
