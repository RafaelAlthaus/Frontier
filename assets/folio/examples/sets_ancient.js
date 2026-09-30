// FOLIO demo — Alexandria, a colonnaded courtyard at midday: a paved floor in perspective, a stoa receding on
// the left, a temple front across the court, a bronze gnomon whose shadow shortens as the sun climbs;
// the sun's ray and the angle at the tip are drawn (Eratosthenes, 7.2°). Slow push-in.
FOLIO.scene({ build(S) {
  const sky = S.layer({ p: 0.1, name: "sky" });
  S.set.sky(sky, { kind: "day", horizon: 560, seed: 12, clouds: 4, sun: { x: 380, y: 150, r: 44 } });
  const back = S.layer({ p: 0.55, name: "back" });
  S.set.temple(back, { x: 1250, y: 560, w: 760, h: 440, n: 6, far: 0.12 });
  S.set.tree(back, { x: 1720, y: 560, h: 330, kind: "cypress", far: 0.15 });
  S.set.tree(back, { x: 1800, y: 560, h: 280, kind: "cypress", far: 0.18 });
  S.set.palm(back, { x: 770, y: 562, h: 300, seed: 4, far: 0.15 });
  const court = S.layer({ p: 1, name: "court" });
  S.set.courtyard(court, { vp: { x: 1180, y: 470 }, y: 560, slab: 190, seed: 3 });
  S.set.colonnade(court, { view: "perspective", vp: { x: 1180, y: 470 }, near: { x: 180, y: 1040, h: 900 }, n: 9, gap: 0.6, order: "doric" });
  const gn = S.prop.gnomon(court, { x: 1150, y: 880, h: 330, ray: true, angle: true, sun: { elev: 60, dir: 8 },
    track: [{ t: 0, elev: 58, dir: 8 }, { t: S.dur, elev: 82.8, dir: 0 }] });
  const fg = S.layer({ p: 1.35, name: "fg", blur: 6 });
  S.prop.amphora(fg, { x: 1760, y: 1180, s: 1.5 });
  S.cam([{ t: 0, x: 980, y: 560, zoom: 1 }, { t: S.dur, x: 1060, y: 600, zoom: 1.1, e: "smooth" }]);
}});
