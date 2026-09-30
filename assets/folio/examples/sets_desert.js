// FOLIO demo — the Nile valley: hazy far dunes, the river with papyrus and palms on the far bank, an obelisk,
// date palms and beach grass in a blurred foreground; a slow camera push toward the obelisk.
FOLIO.scene({ build(S) {
  const sky = S.layer({ p: 0.08, name: "sky" });
  S.set.sky(sky, { kind: "day", horizon: 600, seed: 6, clouds: 4, sun: { x: 1560, y: 210, r: 46 } });
  const far = S.layer({ p: 0.3, name: "far", blur: 1.2 });
  S.set.dunes(far, { y: 540, n: 2, h: 150, floor: false, seed: 4, airFar: 0.55 });
  S.set.haze(far, { kind: "up", y: 600, h: 120, below: 40, a: 0.5, fade: 0 });
  const mid = S.layer({ p: 0.62, name: "mid" });
  S.set.river(mid, { y: 612, h: 118, palms: 9, reeds: 4, seed: 3 });
  S.prop.ship(mid, { kind: "felucca", x: 640, y: 668, s: 0.3, far: 0.25, waterColor: "#8DB9C0", rock: 1.5 });
  const near = S.layer({ p: 1, name: "near" });
  S.set.dunes(near, { y: 760, n: 1, h: 90, floor: false, seed: 11, width: 1400, bushes: 4, far: 0 });
  S.set.obelisk(near, { x: 1010, y: 840, h: 560 });
  S.prop.shadow(near, { x: 1080, y: 842, w: 260, h: 26 });
  S.set.palm(near, { x: 1540, y: 900, h: 640, seed: 3, lean: 0.12 });
  S.set.palm(near, { x: 1730, y: 930, h: 470, seed: 8, lean: 0.22 });
  S.set.palm(near, { x: 250, y: 880, h: 560, seed: 5, lean: -0.15 });
  S.prop.amphora(near, { x: 1250, y: 880, s: 0.5 });
  S.prop.jar(near, { x: 1320, y: 890, s: 0.55 });
  S.prop.flock(sky, { area: [700, 170, 500, 140], n: 5, drift: [10, -1] });
  const fg = S.layer({ p: 1.45, name: "fg", blur: 7 });
  S.set.grass(fg, { x: 170, y: 1130, w: 520, h: 430, seed: 2 });
  S.set.grass(fg, { x: 1830, y: 1140, w: 380, h: 360, seed: 9 });
  S.cam([{ t: 0, x: 960, y: 540, zoom: 1 }, { t: S.dur, x: 1010, y: 560, zoom: 1.12, e: "smooth" }]);
}});
