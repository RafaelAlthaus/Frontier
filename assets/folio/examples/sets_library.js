// FOLIO demo — the Library of Alexandria: pigeonhole walls of scrolls between Ionic columns, a bright doorway,
// a light shaft with dust, lamp-lit reading table; a slow push toward the table; foreground lampstand blurred.
FOLIO.scene({ build(S) {
  const room = S.layer({ p: 0.85, name: "room" });
  S.set.library(room, { seed: 4 });
  const fg = S.layer({ p: 1.5, name: "fg", blur: 9 });
  S.set.column(fg, { x: -60, y: 1300, h: 1500, order: "ionic", color: "#D9C39A" });
  S.prop.amphora(fg, { x: 1840, y: 1180, s: 1.6 });
  S.cam([{ t: 0, x: 960, y: 540, zoom: 1 }, { t: S.dur, x: 960, y: 600, zoom: 1.08, e: "smooth" }]);
}});
