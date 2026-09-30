/* FOLIO — diagram: the engineering book. Cream paper, sepia line art, blue for motion and forces, orange for
 * the answer, red for what is wrong. World space (draw on a layer; the camera moves over it).
 *
 *  S.paper(L, {tone:"cool"|"warm", grid:true, cell:40, major:5, vignette:true})   the sheet (oversized, cream #E5DEC4 / #E2D4B9)
 *  S.draw(node, t0, dur=0.8, ease="smooth")          draw any stroked element (path/line/circle/polyline, or a group) on
 *  S.ink(L, markup, {at, dur:1.2, stagger:0.04, color:"#563B2A", width:2.4, fillAfter:true})
 *                                                     sepia line art from SVG markup, drawn on stroke by stroke, fills fade in after
 *  S.arrow(L, {from:[x,y], to:[x,y], bend:0, color:"#3F627C", width:4, head:18, at, dur:0.5, dash})   a thin arrow drawing on
 *  S.bigArrow(L, {from, to, bend:0, width:64, color:"blue"|"orange"|"#hex", glow, at, dur:0.7})     a thick block arrow (AIR, LIFT)
 *  S.spin(L, {x, y, rx:60, ry:22, a0:-160, a1:150, color:"#3F7BBF", width:5, at, dur:0.6, rot:0})  a curved rotation arrow (roll/pitch/yaw)
 *  S.angle(L, {x, y, r:120, a0, a1, color:"#C13A29", label, at, dur:0.6, size:40})               an angle arc (degrees, 0 = right, clockwise)
 *  S.dot(L, {x, y, r:9, color:"#563B2A", at})                                                    a point
 *  S.text(L, text, {x, y, size:40, font:"serif"|"sans", color, anchor:"start"|"middle"|"end", at, weight, keep})   words on the sheet
 *                                                     (keep: true = the same size on screen however far the camera pulls back)
 *  S.keepWidth(L, node, w)                           a line that keeps its on-screen width while the camera zooms
 *  S.flow(L, {x0:-200, x1:2120, y0:120, y1:960, n:13, bend:(x,y)=>dy, color:"#3F7BBF", ink:"#8C6E54", at, speed:120,
 *            markers:[x, …], ahead:(x,y)=>dx})     streamlines (blue dashed, thin ink between) that draw on and flow;
 *                                                     markers = dotted time lines with a dot on each streamline, drifting
 *                                                     downstream (ahead: how far the air at height y runs ahead)
 *  S.blob(L, {x, y, r:420, color:"#A9CBEA", a:.55, at, dur:0.8, seed})                           a watercolour blob spreading
 *  S.hatch(L, color="#563B2A") → "url(#…)"                                                        a hatched fill
 * Colours: S.C = {paper, paperWarm, ink, cream, blue, blueInk, blueFill, orange, orangeCore, red, grey}
 */
(function () {
  "use strict";
  const F = window.FOLIO;
  const W = F.W, H = F.H;
  const C = (F.C = { paper: "#E5DEC4", paperWarm: "#E2D4B9", ink: "#563B2A", cream: "#F6F0DC", blue: "#3F7BBF",
                     blueInk: "#3F627C", blueFill: "#6EA2CA", orange: "#E8A33A", orangeCore: "#EFC37B", red: "#C13A29",
                     grey: "#A89A80" });

  F.plugins.push((S) => {
    S.C = C;

    S.paper = (L, o = {}) => {
      const span = o.span ?? 1600, base = o.tone === "warm" ? C.paperWarm : C.paper;
      const g = F.el("g", null, L.g);
      F.el("rect", { x: -span, y: -span, width: W + 2 * span, height: H + 2 * span, fill: base, "data-cover": 1 }, g);
      // a faint warm unevenness, like a real sheet under a lamp
      F.el("rect", { x: -span / 2, y: -span / 2, width: W + span, height: H + span,
                     fill: F.rg(L.defs, [[0, "#FFFFFF", 0.22], [0.6, "#FFFFFF", 0.05], [1, "#FFFFFF", 0]], 0.5, 0.42, 0.75) }, g);
      if (o.grid !== false) {
        const cell = o.cell ?? 40, major = o.major ?? 5;
        const idS = F.uid("gs"), idM = F.uid("gm");
        const ps = F.el("pattern", { id: idS, width: cell, height: cell, patternUnits: "userSpaceOnUse" }, L.defs);
        F.el("path", { d: `M ${cell} 0 L 0 0 0 ${cell}`, fill: "none", stroke: "#8A7454", "stroke-width": 1, opacity: 0.16 }, ps);
        const pm = F.el("pattern", { id: idM, width: cell * major, height: cell * major, patternUnits: "userSpaceOnUse" }, L.defs);
        F.el("path", { d: `M ${cell * major} 0 L 0 0 0 ${cell * major}`, fill: "none", stroke: "#8A7454", "stroke-width": 1.6, opacity: 0.2 }, pm);
        F.el("rect", { x: -span, y: -span, width: W + 2 * span, height: H + 2 * span, fill: `url(#${idS})`, "data-cover": 1 }, g);
        F.el("rect", { x: -span, y: -span, width: W + 2 * span, height: H + 2 * span, fill: `url(#${idM})`, "data-cover": 1 }, g);
      }
      if (o.vignette !== false) {
        const v = S.div("fx");
        Object.assign(v.style, { left: 0, top: 0, width: W + "px", height: H + "px",
          background: "radial-gradient(ellipse 80% 75% at 50% 45%, rgba(0,0,0,0) 50%, rgba(92,66,36,.22) 100%)" });
      }
      return { g };
    };

    S.draw = (node, t0, dur = 0.8, e = "smooth") => {
      const items = node.tagName === "g" ? Array.from(node.querySelectorAll("path,line,polyline,polygon,circle,ellipse,rect")) : [node];
      const lens = items.map((n) => { try { return n.getTotalLength(); } catch (err) { return 0; } });
      items.forEach((n, i) => { if (lens[i] > 0) { n.setAttribute("stroke-dasharray", `${lens[i]} ${lens[i]}`); n.setAttribute("stroke-dashoffset", lens[i]); } });
      S.on((t) => {
        const p = F.ease(e)(F.seg(t, t0, t0 + dur));
        items.forEach((n, i) => { if (lens[i] > 0) n.setAttribute("stroke-dashoffset", (lens[i] * (1 - p)).toFixed(2)); });
      });
      return node;
    };

    S.ink = (L, markup, o = {}) => {
      const at = o.at ?? 0.3, dur = o.dur ?? 1.2, color = o.color || C.ink, width = o.width ?? 2.4;
      const g = F.svg(markup, L.g, { fill: "none", stroke: color, "stroke-width": width, "stroke-linecap": "round", "stroke-linejoin": "round" });
      const strokes = Array.from(g.querySelectorAll("path,line,polyline,polygon,circle,ellipse,rect"));
      const fills = [];
      strokes.forEach((n, i) => {
        const f = n.getAttribute("fill");
        if (f && f !== "none" && o.fillAfter !== false) { fills.push([n, n.getAttribute("fill-opacity") || 1]); n.setAttribute("fill-opacity", 0); }
        let len = 0; try { len = n.getTotalLength(); } catch (err) { len = 0; }
        if (!len) return;
        n.setAttribute("stroke-dasharray", `${len} ${len}`); n.setAttribute("stroke-dashoffset", len);
        const st = at + (o.stagger ?? 0.04) * i * Math.min(1, 30 / strokes.length), d = Math.max(0.25, dur - (o.stagger ?? 0.04) * i * 0.5);
        S.on((t) => n.setAttribute("stroke-dashoffset", (len * (1 - F.smooth(F.seg(t, st, st + d)))).toFixed(2)));
      });
      if (fills.length) S.on((t) => { const p = F.smooth(F.seg(t, at + dur * 0.7, at + dur + 0.3)); fills.forEach(([n, a]) => n.setAttribute("fill-opacity", (a * p).toFixed(3))); });
      return g;
    };

    const curve = (from, to, bend) => {
      const [x0, y0] = from, [x1, y1] = to, mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
      const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1;
      const cx = mx - (dy / len) * bend * len, cy = my + (dx / len) * bend * len;
      return { d: `M ${x0} ${y0} Q ${cx} ${cy} ${x1} ${y1}`, cx, cy };
    };

    S.arrow = (L, o = {}) => {
      const from = o.from || [800, 540], to = o.to || [1100, 540], color = o.color || C.blueInk, width = o.width ?? 4, head = o.head ?? 18;
      const at = o.at ?? 0.4, dur = o.dur ?? 0.5;
      const g = F.el("g", null, L.g);
      const c = curve(from, to, o.bend || 0);
      const p = F.el("path", { d: c.d, fill: "none", stroke: color, "stroke-width": width, "stroke-linecap": "round",
                               "stroke-dasharray": o.dash || null }, g);
      const hd = F.el("path", { d: `M 0 0 L ${-head} ${-head * 0.55} L ${-head * 0.72} 0 L ${-head} ${head * 0.55} Z`, fill: color, opacity: 0 }, g);
      const len = p.getTotalLength();
      if (!o.dash) { p.setAttribute("stroke-dasharray", `${len} ${len}`); }
      S.on((t) => {
        const q = F.smooth(F.seg(t, at, at + dur));
        if (!o.dash) p.setAttribute("stroke-dashoffset", (len * (1 - q)).toFixed(2));
        else p.setAttribute("opacity", q > 0 ? 1 : 0);
        const pt = p.getPointAtLength(len * q), pb = p.getPointAtLength(Math.max(0, len * q - 2));
        const a = (Math.atan2(pt.y - pb.y, pt.x - pb.x) * 180) / Math.PI;
        hd.setAttribute("transform", `translate(${pt.x.toFixed(1)} ${pt.y.toFixed(1)}) rotate(${a.toFixed(1)})`);
        hd.setAttribute("opacity", q > 0.02 ? 1 : 0);
      });
      return g;
    };

    S.bigArrow = (L, o = {}) => {
      const from = o.from || [960, 700], to = o.to || [960, 250], w = o.width ?? 64, at = o.at ?? 0.4, dur = o.dur ?? 0.7;
      const col = o.color === "orange" ? [C.orangeCore, C.orange, "#C9832A"] : o.color === "blue" || !o.color ? ["#8DB8DC", C.blueFill, "#3F6E99"]
        : [F.shade(o.color, 0.3), o.color, F.shade(o.color, -0.3)];
      const g = F.el("g", null, L.g);
      if (o.glow || o.color === "orange") {
        const [gx, gy] = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
        const gl = F.el("ellipse", { cx: gx, cy: gy, rx: w * 1.9, ry: Math.hypot(to[0] - from[0], to[1] - from[1]) * 0.55,
                                     fill: F.rg(L.defs, [[0, col[0], 0.55], [1, col[0], 0]]), opacity: 0,
                                     transform: `rotate(${(Math.atan2(to[1] - from[1], to[0] - from[0]) * 180) / Math.PI + 90} ${gx} ${gy})` }, g);
        S.on((t) => gl.setAttribute("opacity", (F.smooth(F.seg(t, at + dur * 0.5, at + dur + 0.4)) * (0.9 + 0.1 * Math.sin(t * 3))).toFixed(3)));
      }
      const c = curve(from, to, o.bend || 0);
      const guide = F.el("path", { d: c.d, fill: "none", stroke: "none" }, g);
      const L0 = guide.getTotalLength();
      const body = F.el("path", { fill: F.lg(L.defs, [col[0], col[1]], 0, 0, 1, 0), stroke: col[2], "stroke-width": 2.5, "stroke-linejoin": "round" }, g);
      const shine = F.el("path", { fill: "none", stroke: "#FFFFFF", "stroke-width": w * 0.12, "stroke-linecap": "round", opacity: 0.45 }, g);
      const hw = w / 2, headL = w * 1.05, headW = w * 0.95;
      S.on((t) => {
        const q = F.eOut(F.seg(t, at, at + dur));
        if (q <= 0.001) { body.setAttribute("d", ""); shine.setAttribute("d", ""); return; }
        const len = Math.max(headL + 2, L0 * q), shaft = len - headL, n = 24, left = [], right = [];
        for (let i = 0; i <= n; i++) {
          const s = (shaft * i) / n, a = guide.getPointAtLength(s), b = guide.getPointAtLength(Math.min(L0, s + 1));
          const ang = Math.atan2(b.y - a.y, b.x - a.x), nx = -Math.sin(ang), ny = Math.cos(ang);
          left.push([a.x + nx * hw, a.y + ny * hw]); right.push([a.x - nx * hw, a.y - ny * hw]);
        }
        const a = guide.getPointAtLength(shaft), tip = guide.getPointAtLength(len);
        const ang = Math.atan2(tip.y - a.y, tip.x - a.x), nx = -Math.sin(ang), ny = Math.cos(ang);
        const d = "M" + left.map((p) => p.map((v) => v.toFixed(1)).join(" ")).join(" L") +
          ` L ${(a.x + nx * headW).toFixed(1)} ${(a.y + ny * headW).toFixed(1)} L ${tip.x.toFixed(1)} ${tip.y.toFixed(1)}` +
          ` L ${(a.x - nx * headW).toFixed(1)} ${(a.y - ny * headW).toFixed(1)} L ` +
          right.reverse().map((p) => p.map((v) => v.toFixed(1)).join(" ")).join(" L") + " Z";
        body.setAttribute("d", d);
        const s0 = guide.getPointAtLength(shaft * 0.08), s1 = guide.getPointAtLength(shaft * 0.85);
        shine.setAttribute("d", `M ${(s0.x + nx * hw * 0.35).toFixed(1)} ${(s0.y + ny * hw * 0.35).toFixed(1)} L ${(s1.x + nx * hw * 0.35).toFixed(1)} ${(s1.y + ny * hw * 0.35).toFixed(1)}`);
      });
      return g;
    };

    S.spin = (L, o = {}) => {
      const x = o.x ?? 960, y = o.y ?? 540, rx = o.rx ?? 60, ry = o.ry ?? 22, a0 = o.a0 ?? -160, a1 = o.a1 ?? 150;
      const color = o.color || C.blue, width = o.width ?? 5, at = o.at ?? 0.4, dur = o.dur ?? 0.6, head = o.head ?? 16;
      const g = F.el("g", { transform: `translate(${x} ${y}) rotate(${o.rot || 0})` }, L.g);
      const pts = [];
      for (let i = 0; i <= 48; i++) { const a = ((a0 + ((a1 - a0) * i) / 48) * Math.PI) / 180; pts.push(`${(Math.cos(a) * rx).toFixed(2)} ${(Math.sin(a) * ry).toFixed(2)}`); }
      const p = F.el("path", { d: "M" + pts.join(" L"), fill: "none", stroke: color, "stroke-width": width, "stroke-linecap": "round",
                               "stroke-dasharray": o.dash || null }, g);
      const hd = F.el("path", { d: `M 0 0 L ${-head} ${-head * 0.55} L ${-head * 0.7} 0 L ${-head} ${head * 0.55} Z`, fill: color }, g);
      const len = p.getTotalLength();
      if (!o.dash) p.setAttribute("stroke-dasharray", `${len} ${len}`);
      S.on((t) => {
        const q = F.smooth(F.seg(t, at, at + dur));
        if (!o.dash) p.setAttribute("stroke-dashoffset", (len * (1 - q)).toFixed(2)); else p.setAttribute("opacity", q > 0 ? 1 : 0);
        const pt = p.getPointAtLength(len * q), pb = p.getPointAtLength(Math.max(0, len * q - 2));
        hd.setAttribute("transform", `translate(${pt.x.toFixed(1)} ${pt.y.toFixed(1)}) rotate(${((Math.atan2(pt.y - pb.y, pt.x - pb.x) * 180) / Math.PI).toFixed(1)})`);
        hd.setAttribute("opacity", q > 0.03 ? 1 : 0);
      });
      return g;
    };

    S.angle = (L, o = {}) => {
      const x = o.x ?? 960, y = o.y ?? 540, r = o.r ?? 120, a0 = o.a0 ?? -90, a1 = o.a1 ?? -60, color = o.color || C.red;
      const at = o.at ?? 0.4, dur = o.dur ?? 0.6;
      const g = F.el("g", null, L.g);
      const arc = F.el("path", { fill: "none", stroke: color, "stroke-width": o.width ?? 4, "stroke-linecap": "round" }, g);
      const wedge = F.el("path", { fill: color, opacity: 0.14 }, g);
      let lab = null;
      if (o.label) {
        const am = (((a0 + a1) / 2) * Math.PI) / 180, lr = r + (o.labelOffset ?? 42);
        lab = F.el("text", { x: x + Math.cos(am) * lr, y: y + Math.sin(am) * lr + (o.size ?? 40) * 0.35, "text-anchor": "middle",
                             "font-family": o.font === "serif" ? "EB Garamond" : "Nunito", "font-weight": o.font === "serif" ? 400 : 800,
                             "font-size": o.size ?? 40, fill: o.labelColor || color, text: o.label, opacity: 0 }, g);
      }
      S.on((t) => {
        const q = F.smooth(F.seg(t, at, at + dur)), b = a0 + (a1 - a0) * q;
        const A = (a0 * Math.PI) / 180, B = (b * Math.PI) / 180, large = Math.abs(b - a0) > 180 ? 1 : 0, sw = b > a0 ? 1 : 0;
        const p0 = [x + Math.cos(A) * r, y + Math.sin(A) * r], p1 = [x + Math.cos(B) * r, y + Math.sin(B) * r];
        const d = q > 0.001 ? `M ${p0[0].toFixed(1)} ${p0[1].toFixed(1)} A ${r} ${r} 0 ${large} ${sw} ${p1[0].toFixed(1)} ${p1[1].toFixed(1)}` : "";
        arc.setAttribute("d", d);
        wedge.setAttribute("d", q > 0.001 ? `M ${x} ${y} L ${p0[0].toFixed(1)} ${p0[1].toFixed(1)} A ${r} ${r} 0 ${large} ${sw} ${p1[0].toFixed(1)} ${p1[1].toFixed(1)} Z` : "");
        if (lab) lab.setAttribute("opacity", F.eOut(F.seg(t, at + dur * 0.7, at + dur + 0.3)).toFixed(3));
      });
      return g;
    };

    S.dot = (L, o = {}) => {
      const c = F.el("circle", { cx: o.x ?? 960, cy: o.y ?? 540, r: 0, fill: o.color || C.ink, stroke: o.stroke || null, "stroke-width": o.stroke ? 3 : null }, L.g);
      const at = o.at ?? 0.3, r = o.r ?? 9;
      S.on((t) => c.setAttribute("r", (r * F.eBack(F.seg(t, at, at + 0.35), 2)).toFixed(2)));
      return c;
    };

    S.text = (L, text, o = {}) => {
      const sans = o.font === "sans";
      const n = F.el("text", { x: o.x ?? 960, y: o.y ?? 540, "text-anchor": o.anchor || "start",
                               "font-family": sans ? "Nunito" : "EB Garamond", "font-weight": o.weight ?? (sans ? 800 : 400),
                               "font-size": o.size ?? 40, fill: o.color || (sans ? C.blueInk : C.ink), opacity: 0,
                               style: sans ? "" : "font-variant-numeric: oldstyle-nums", text: sans && o.upper !== false ? String(text).toUpperCase() : text }, L.g);
      const at = o.at ?? 0.3, ax = o.x ?? 960, ay = o.y ?? 540;
      S.on((t) => {
        const p = F.eOut(F.seg(t, at, at + 0.45)), f = o.until == null ? 1 : 1 - F.smooth(F.seg(t, o.until, o.until + 0.35));
        n.setAttribute("opacity", (p * f).toFixed(3));
        const k = o.keep ? 1 / F.layerScale(L) : 1;
        n.setAttribute("transform", `translate(${ax} ${(ay + (1 - p) * (o.rise ?? 8) * k).toFixed(2)}) scale(${k.toFixed(4)}) translate(${-ax} ${-ay})`);
      });
      return n;
    };

    // a stroke that keeps its on-screen width while the camera zooms: S.keepWidth(L, node, 3)
    S.keepWidth = (L, node, w) => { S.on(() => node.setAttribute("stroke-width", (w / F.layerScale(L)).toFixed(3))); return node; };

    S.flow = (L, o = {}) => {
      const x0 = o.x0 ?? -200, x1 = o.x1 ?? W + 200, y0 = o.y0 ?? 120, y1 = o.y1 ?? H - 120, n = o.n ?? 13;
      const bend = o.bend || (() => 0), at = o.at ?? 0.3, speed = o.speed ?? 120;
      const g = F.el("g", null, L.g);
      const lines = [], paths = [];
      const pathAt = (y) => { const pts = []; for (let k = 0; k <= 80; k++) { const x = x0 + ((x1 - x0) * k) / 80; pts.push([x, y + bend(x, y)]); } return pts; };
      // blue dashed streamlines, with a thin ink line half-way between each pair (the reference's two-tone field)
      for (let i = 0; i < 2 * n - 1; i++) {
        const y = y0 + ((y1 - y0) * i) / Math.max(1, 2 * n - 2), pts = pathAt(y);
        const d = "M" + pts.map((q) => `${q[0].toFixed(1)} ${q[1].toFixed(1)}`).join(" L");
        const blue = i % 2 === 0;
        const el = F.el("path", { d, fill: "none", stroke: blue ? (o.color || C.blue) : (o.ink || "#8C6E54"),
                                  "stroke-width": blue ? 3 : 1.4, "stroke-dasharray": blue ? "16 12" : null,
                                  "stroke-linecap": "round", opacity: 0 }, g);
        lines.push({ el, blue, len: el.getTotalLength(), st: at + i * 0.025 });
        if (blue) paths.push(pts);
      }
      lines.forEach((l) => { if (!l.blue) l.el.setAttribute("stroke-dasharray", `${l.len} ${l.len}`); });
      // time lines: dotted verticals through the field, a blue dot where each crosses a streamline; the air above
      // the wing runs ahead, so a marker bends forward there as it drifts downstream
      const marks = (o.markers || []).map((mx) => {
        const mg = F.el("g", { opacity: 0 }, g);
        const line = F.el("path", { fill: "none", stroke: "#8C6E54", "stroke-width": 1.6, "stroke-dasharray": "2 6", "stroke-linecap": "round" }, mg);
        const dots = paths.map(() => F.el("circle", { r: 5.5, fill: o.color || C.blue }, mg));
        return { mx, mg, line, dots };
      });
      S.on((t) => {
        for (const l of lines) {
          const p = F.smooth(F.seg(t, l.st, l.st + 0.9));
          if (l.blue) {
            l.el.setAttribute("opacity", (0.9 * p).toFixed(3));
            l.el.setAttribute("stroke-dashoffset", (-(t - l.st) * speed).toFixed(1));
          } else {
            l.el.setAttribute("opacity", (0.55 * (p > 0 ? 1 : 0)).toFixed(3));
            l.el.setAttribute("stroke-dashoffset", (l.len * (1 - p)).toFixed(1));
          }
        }
        for (const m of marks) {
          const drift = Math.max(0, t - at - 0.6) * speed * 0.35;
          const pts = paths.map((pts, i) => {
            const ahead = (o.ahead ? o.ahead(m.mx, pts[0][1]) : 0) * Math.min(1, drift / 400);
            const x = m.mx + drift + ahead, k = Math.max(0, Math.min(80, Math.round(((x - x0) / (x1 - x0)) * 80)));
            return [x, pts[k][1]];
          });
          m.line.setAttribute("d", "M" + pts.map((q) => `${q[0].toFixed(1)} ${q[1].toFixed(1)}`).join(" L"));
          pts.forEach((q, i) => { m.dots[i].setAttribute("cx", q[0].toFixed(1)); m.dots[i].setAttribute("cy", q[1].toFixed(1)); });
          m.mg.setAttribute("opacity", F.smooth(F.seg(t, at + 0.5, at + 1.1)).toFixed(3));
        }
      });
      return g;
    };

    S.blob = (L, o = {}) => {
      const x = o.x ?? 960, y = o.y ?? 540, r = o.r ?? 420, color = o.color || "#A9CBEA", a = o.a ?? 0.55, at = o.at ?? 0.2, dur = o.dur ?? 0.8;
      const seed = o.seed ?? 7, n = 72;
      const g = F.el("g", { opacity: 0 }, L.g);
      const fill = F.el("path", { fill: color, "fill-opacity": a, filter: F.blurFilter(L.defs, 6, 0.2) }, g);
      const rim = F.el("path", { fill: "none", stroke: F.shade(color, -0.25), "stroke-width": 5, "stroke-opacity": 0.35,
                                 filter: F.blurFilter(L.defs, 2.5, 0.2) }, g);
      S.on((t) => {
        const q = F.eOut(F.seg(t, at, at + dur));
        g.setAttribute("opacity", q > 0 ? 1 : 0);
        if (q <= 0) return;
        const pts = [];
        for (let i = 0; i < n; i++) {
          const ang = (i / n) * Math.PI * 2;
          const k = 1 + 0.13 * F.noise(i * 0.35, seed) + 0.06 * F.noise(i * 1.3, seed + 3) + 0.02 * Math.sin(t * 0.8 + i);
          pts.push([x + Math.cos(ang) * r * q * k * 1.12, y + Math.sin(ang) * r * q * k * 0.86]);
        }
        const d = "M" + pts.map((p) => p.map((v) => v.toFixed(1)).join(" ")).join(" L") + " Z";
        fill.setAttribute("d", d); rim.setAttribute("d", d);
      });
      return g;
    };

    S.hatch = (L, color = C.ink) => {
      const id = F.uid("ht");
      const p = F.el("pattern", { id, width: 9, height: 9, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" }, L.defs);
      F.el("line", { x1: 0, y1: 0, x2: 0, y2: 9, stroke: color, "stroke-width": 1.8, opacity: 0.6 }, p);
      return `url(#${id})`;
    };
  });
})();
