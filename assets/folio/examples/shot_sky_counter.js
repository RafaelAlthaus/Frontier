// Example shot — "Every day, around 100,000 planes climb into the sky."
// The reference's opening: a white airliner seen from below climbing through a blue sky crossed with contrails,
// sun glints on its skin, the number counting up bottom-right. Shows custom drawing in the FOLIO manner: every
// fill a soft two-stop gradient, outlines in a darker shade of the fill, one shadow side, no black.
FOLIO.scene({ build(S) {
  const F = FOLIO;
  const tNum = S.at("100,000", 0.35), tSky = S.at("sky", 0.8);

  // the sky: deep at the top, milky toward the bottom, and a soft bright area where the sun is
  const sky = S.layer({ p: 0.15, name: "sky" });
  sky.add(`<rect x="0" y="0" width="1920" height="1080" data-cover="1" fill="${F.lg(sky.defs, [[0, "#7DB4E6"], [0.55, "#A9D0F0"], [1, "#DCEDF8"]])}"/>`);
  S.glow(sky, { x: 1650, y: 120, r: 700, color: "#FFFFFF", a: 0.55 });

  // contrails: long soft white bands at two depths, each with a thin bright core
  const trails = (L, n, seed, w0, a0) => {
    const R = F.rnd(seed), blur = F.blurFilter(L.defs, 9, 0.2);
    for (let i = 0; i < n; i++) {
      const y = -300 + R() * 1700, ang = -24 - R() * 20, len = 2600, w = w0 * (0.6 + R() * 0.8);
      const g = F.el("g", { transform: `translate(-600 ${y.toFixed(0)}) rotate(${ang.toFixed(1)})`, opacity: (a0 * (0.6 + R() * 0.4)).toFixed(2) }, L.g);
      F.el("rect", { x: 0, y: -w / 2, width: len, height: w, rx: w / 2, fill: "#FFFFFF", filter: blur }, g);
      F.el("rect", { x: 300, y: -w * 0.12, width: len - 600, height: w * 0.24, rx: w * 0.12, fill: "#FFFFFF", opacity: 0.8 }, g);
    }
  };
  const far = S.layer({ p: 0.35, name: "far trails" });
  trails(far, 7, 11, 34, 0.55);
  const near = S.layer({ p: 0.7, name: "near trails" });
  trails(near, 4, 23, 70, 0.7);

  // the airliner from below: fuselage, swept wings with engines, tailplane — drawn around its own centre
  const mid = S.layer({ p: 1, name: "plane" });
  const body = F.lg(mid.defs, [[0, "#FFFFFF"], [1, "#D9E1EA"]], 0, 0, 1, 0);
  const wing = F.lg(mid.defs, [[0, "#F4F7FA"], [1, "#C9D3DE"]], 0, 0, 0, 1);
  const eng = F.lg(mid.defs, [[0, "#FFFFFF"], [1, "#BFC9D4"]], 0, 0, 1, 0);
  const ink = F.ink("#C9D3DE");
  const plane = F.svg(`
    <path d="M 150 -36 L -140 -335 L -215 -335 L -110 -36 Z M 150 36 L -140 335 L -215 335 L -110 36 Z" fill="${wing}" stroke="${ink}" stroke-width="3" stroke-linejoin="round"/>
    <path d="M -380 -30 L -505 -150 L -548 -150 L -470 -30 Z M -380 30 L -505 150 L -548 150 L -470 30 Z" fill="${wing}" stroke="${ink}" stroke-width="3" stroke-linejoin="round"/>
    <rect x="-560" y="-42" width="1000" height="84" rx="42" fill="${body}" stroke="${ink}" stroke-width="3"/>
    <path d="M 400 -42 C 470 -42 520 -20 540 0 C 520 20 470 42 400 42 Z" fill="${body}" stroke="${ink}" stroke-width="3"/>
    <rect x="-20" y="-196" width="130" height="46" rx="23" fill="${eng}" stroke="${ink}" stroke-width="3"/>
    <rect x="-20" y="150" width="130" height="46" rx="23" fill="${eng}" stroke="${ink}" stroke-width="3"/>
    <rect x="-26" y="-188" width="14" height="30" rx="6" fill="#9FAAB6"/>
    <rect x="-26" y="158" width="14" height="30" rx="6" fill="#9FAAB6"/>
    <path d="M -560 -30 L 440 -30" stroke="#FFFFFF" stroke-width="10" stroke-linecap="round" opacity="0.7"/>`, mid.g);
  // it climbs up and right across the frame, turning a little
  S.on((t) => {
    const p = t / S.dur;
    F.tf(plane, { x: F.lerp(640, 1180, p), y: F.lerp(760, 300, p), r: F.lerp(-38, -44, p), s: 0.62 });
  });
  S.sparkle(mid, { x: 1030, y: 470, t: tSky - 0.4, size: 70 });
  S.sparkle(mid, { x: 1260, y: 330, t: S.dur - 0.9, size: 50 });

  // the number, counting up on its word, with what it counts under it
  S.count({ from: 86140, to: 100000, at: tNum - 0.5, dur: 1.4, x: 96, y: 830, label: "planes, every day" });

  // the camera follows the climb: a slow drift up and right, easing out of a small pull-back
  S.cam([{ t: 0, x: 900, y: 600, zoom: 1.08 }, { t: S.dur, x: 1010, y: 470, zoom: 1.0 }]);
}});
