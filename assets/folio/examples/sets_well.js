// FOLIO demo — the well at Syene: first the stone well at noon under a high sun (the rod beside it casts no
// shadow), then a dissolve to looking straight down the shaft, where the sun shines back from the water.
FOLIO.scene({ build(S) {
  const F = FOLIO;
  const sky = S.layer({ p: 0.1, name: "sky" });
  S.set.sky(sky, { kind: "day", horizon: 700, seed: 9, clouds: 3, sun: { x: 960, y: 90, r: 50 } });
  const land = S.layer({ p: 0.5, name: "land" });
  S.set.dunes(land, { y: 640, n: 2, h: 110, floor: false, seed: 2 });
  S.set.village(land, { y: 690, n: 6, size: 150, far: 0.3, seed: 4 });
  const ground = S.layer({ p: 1, name: "ground" });
  S.set.ground(ground, { y: 730, kind: "sand", seed: 5 });
  S.set.well(ground, { x: 900, y: 930, w: 520, roof: false });
  S.prop.gnomon(ground, { x: 1420, y: 900, h: 300, sun: { elev: 89.5, dir: 0 } });
  S.set.palm(ground, { x: 1760, y: 960, h: 560, seed: 6 });
  S.prop.jar(ground, { x: 560, y: 950, s: 0.7 });
  const top = S.layer({ p: 1, name: "top" });
  S.set.well(top, { view: "top", x: 960, y: 540, r: 520 });
  const t0 = S.dur * 0.45, t1 = S.dur * 0.6;
  const sideLayers = [sky, land, ground];
  S.on((t) => {
    const p = F.smooth(F.seg(t, t0, t1));
    top.div.style.opacity = p.toFixed(3); top._op = top.opacity = +p.toFixed(3);
  });
  S.cam([{ t: 0, x: 960, y: 560, zoom: 1 }, { t: t1, x: 920, y: 700, zoom: 1.25, e: "inout" }, { t: S.dur, x: 960, y: 540, zoom: 1.05 }]);
  void sideLayers;
}});
