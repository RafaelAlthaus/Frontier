// FOLIO demo — space: a deep blue starfield, the Earth turning with its clouds and night side, a satellite
// drifting across in front, the Moon far off; slow drift.
FOLIO.scene({ build(S) {
  const stars = S.layer({ p: 0.05, name: "stars" });
  S.set.starfield(stars, { seed: 4 });
  const moon = S.layer({ p: 0.15, name: "moon" });
  S.set.moon(moon, { x: 330, y: 250, r: 70, phase: "full" });
  const earth = S.layer({ p: 0.35, name: "earth" });
  S.set.earth(earth, { x: 1340, y: 640, r: 420, lon: 15, tilt: 20, spin: 3 });
  const sat = S.layer({ p: 1, name: "sat" });
  S.prop.satellite(sat, { x: 700, y: 560, s: 0.9, spin: 4, move: { x0: 600, x1: 820, t0: 0, t1: S.dur, y: 560 } });
  S.cam([{ t: 0, x: 960, y: 540, zoom: 1 }, { t: S.dur, x: 1010, y: 540, zoom: 1.04 }]);
}});
