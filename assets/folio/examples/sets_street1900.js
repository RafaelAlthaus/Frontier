// FOLIO demo — a main street c. 1900 in one-point perspective (Dayton, Ohio in the reference): brick shops,
// telegraph poles and wires, lamp posts, round trees, clapboard houses, the sun hazing the vanishing point,
// a horse cart far down the road, a blurred lamp post in front; a slow pull-back reveal.
FOLIO.scene({ build(S) {
  const sky = S.layer({ p: 0.1, name: "sky" });
  S.set.sky(sky, { kind: "day", horizon: 560, seed: 2, clouds: 3, sun: { x: 1170, y: 470, r: 42 } });
  const st = S.layer({ p: 1, name: "street" });
  const street = S.set.street(st, { vp: { x: 1170, y: 520 }, seed: 7 });
  const far = street.pr(0.8, 0, 42), sc = street.scale(42);
  S.prop.horse(st, { x: far[0] + sc * 1.3, y: far[1], s: sc / 300 * 0.9, walk: 0.8, far: 0.35, air: "#F3E6CE" });
  S.prop.cart(st, { x: far[0] - sc * 0.9, y: far[1], s: sc / 300 * 0.9, kind: "cart", far: 0.35, air: "#F3E6CE", spin: 0.2 });
  const b = street.pr(2.6, 0, 30), sb = street.scale(30);
  S.prop.bicycle(st, { x: b[0], y: b[1], s: sb / 300 * 0.95, far: 0.3, air: "#F3E6CE", spin: 0.4 });
  const fg = S.layer({ p: 1.5, name: "fg", blur: 6 });
  S.set.lampPost(fg, { x: 1860, y: 1500, h: 1500, color: "#2A302C" });
  S.cam([{ t: 0, x: 1020, y: 560, zoom: 1.18 }, { t: 3, x: 960, y: 540, zoom: 1, e: "smooth" }]);
}});
