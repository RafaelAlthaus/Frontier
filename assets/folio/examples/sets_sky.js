// FOLIO demo — the opening shot of the reference: a high blue sky crossed by contrails, soft clouds far below,
// an airliner seen from beneath climbing through it; the camera drifts with the plane.
FOLIO.scene({ build(S) {
  const sky = S.layer({ p: 0.12, name: "sky" });
  S.set.sky(sky, { kind: "day", horizon: 1150, seed: 8, clouds: 0, sun: false, contrails: 7 });
  const low = S.layer({ p: 0.35, name: "clouds", blur: 3 });
  S.set.clouds(low, { n: 6, horizon: 1300, area: [-300, 760, 2520, 1150], size: 700, seed: 5, drift: 12 });
  const trails = S.layer({ p: 0.6, name: "trails", blur: 1.5 });
  S.set.contrails(trails, { n: 3, seed: 21, angle: -32 });
  const plane = S.layer({ p: 1, name: "plane" });
  S.prop.airliner(plane, { x: 1000, y: 520, s: 1.05, r: -38, move: { x0: 900, x1: 1120, t0: 0, t1: S.dur, y: 520 } });
  S.cam([{ t: 0, x: 900, y: 560, zoom: 1.02 }, { t: S.dur, x: 1080, y: 520, zoom: 0.98 }]);
}});
