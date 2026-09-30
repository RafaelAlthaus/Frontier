// Example shot — "A curved wing bends the air downward. Push air down, and the air pushes the wing up. That's lift."
// The reference's Fig. 1: an airfoil on warm paper, streamlines that bend around it, the air pushed down (blue),
// the wing pushed up (orange, glowing). Every element lands on its word; the camera settles in at the start.
FOLIO.scene({ build(S) {
  const F = FOLIO, C = S.C;
  const tWing = S.at("curved wing", 0.05), tDown = S.at("downward", 0.25), tPush = S.at("Push air down", 0.45);
  const tUp = S.at("pushes the wing up", 0.62), tLift = S.at("lift", 0.85);

  const P = S.layer({ name: "paper" });
  S.paper(P, { tone: "warm" });

  // streamlines: straight far from the wing, bending over it and down behind it
  const bend = (x, y) => {
    const dx = (x - 980) / 470, dy = (y - 560) / 330;
    const near = Math.exp(-dy * dy * 0.7);
    const over = -95 * Math.exp(-dx * dx) * near;                          // lifted over the wing
    const down = 230 * (1 / (1 + Math.exp(-(x - 1300) / 150))) * near;     // turned down behind it
    return over + down;
  };
  // the air over the wing runs ahead of the air under it
  const ahead = (x, y) => (y < 560 ? 180 * Math.exp(-(((y - 470) / 200) ** 2)) : 0);
  S.flow(P, { x0: -260, x1: 2180, y0: 40, y1: 1060, n: 11, bend, at: tWing - 0.2, markers: [150, 760], ahead });

  // the wing section, drawn on in sepia, cream inside, with two spar marks
  S.ink(P, `
    <path d="M 640 575 C 700 520, 880 505, 1040 520 C 1180 532, 1300 566, 1390 612 C 1300 588, 1150 575, 1010 580 C 860 586, 720 598, 640 575 Z"
          fill="#F6F0DC"/>
    <rect x="700" y="552" width="30" height="24" fill="#B98A5A" stroke-width="1.6"/>
    <rect x="1180" y="560" width="26" height="20" fill="#B98A5A" stroke-width="1.6"/>`, { at: tWing, dur: 0.9, width: 3 });

  // pressure: lower above the wing, higher below it
  [[860, 470, "−"], [1130, 485, "−"]].forEach(([x, y, s], i) => {
    const c = F.el("circle", { cx: x, cy: y, r: 22, fill: "none", stroke: C.blue, "stroke-width": 2.5, opacity: 0 }, P.g);
    const t = F.el("text", { x, y: y + 9, "text-anchor": "middle", "font-family": "Nunito", "font-weight": 800, "font-size": 30, fill: C.blue, opacity: 0, text: s }, P.g);
    S.tw(tDown + 0.2 + i * 0.12, tDown + 0.5 + i * 0.12, (p) => { c.setAttribute("opacity", p); t.setAttribute("opacity", p); });
  });
  [[780, 660], [990, 668], [1180, 672]].forEach(([x, y], i) => {
    const c = F.el("circle", { cx: x, cy: y, r: 22, fill: "none", stroke: C.orange, "stroke-width": 2.5, opacity: 0 }, P.g);
    const t = F.el("text", { x, y: y + 10, "text-anchor": "middle", "font-family": "Nunito", "font-weight": 800, "font-size": 30, fill: C.orange, opacity: 0, text: "+" }, P.g);
    S.tw(tDown + 0.45 + i * 0.12, tDown + 0.75 + i * 0.12, (p) => { c.setAttribute("opacity", p); t.setAttribute("opacity", p); });
  });

  // the air, pushed down behind the wing — then the wing, pushed up
  S.bigArrow(P, { from: [1410, 640], to: [1590, 950], bend: -0.22, width: 58, color: "blue", at: tPush, dur: 0.8 });
  S.text(P, "air", { x: 1640, y: 820, font: "sans", size: 44, color: C.blueInk, at: tPush + 0.6 });
  S.bigArrow(P, { from: [1010, 520], to: [1010, 150], width: 70, color: "orange", glow: true, at: tUp, dur: 0.8 });
  S.text(P, "lift", { x: 1065, y: 230, font: "sans", size: 52, color: "#B7741F", at: tLift });

  S.fig(1, { at: 0.3 });
  // the camera settles onto the drawing, then holds
  S.cam([{ t: 0, x: 1010, y: 540, zoom: 1.42 }, { t: Math.min(1.6, S.dur * 0.3), x: 1000, y: 545, zoom: 1.24 }, { t: S.dur, x: 996, y: 548, zoom: 1.21 }]);
}});
