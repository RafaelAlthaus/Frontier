// FOLIO demo — an 1878 parlour (the reference's opening room): green damask wallpaper, a dark wainscot, a
// bookshelf, a framed picture, the lamp glowing on a round table with a fringed cloth, red curtains at a night
// window, a rug on the floorboards, a pendulum clock; dust in the lamplight; slow push-in.
FOLIO.scene({ build(S) {
  const room = S.layer({ p: 0.9, name: "room" });
  const par = S.set.parlour(room, { seed: 2 });
  S.set.clock(room, { x: 1200, y: 380, h: 250 });
  S.prop.chair(room, { x: 820, y: 900, s: 0.9, flip: true });
  S.prop.book(room, { x: par.table.top[0] + 120, y: par.table.top[1] + 6, s: 0.9, state: "stack" });
  if (S.motes) S.motes(room, { x: 250, y: 150, w: 600, h: 600, n: 30, seed: 3 });
  S.set.vignette(room, { a: 0.5 });
  const fg = S.layer({ p: 1.35, name: "fg", blur: 8 });
  S.prop.chair(fg, { x: 1760, y: 1250, s: 1.6, kind: "armchair", flip: true });
  S.cam([{ t: 0, x: 960, y: 540, zoom: 1 }, { t: S.dur, x: 900, y: 520, zoom: 1.07, e: "smooth" }]);
}});
