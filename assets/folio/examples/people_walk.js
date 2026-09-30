// FOLIO people demo — two brothers walk in from the left and stop; one raises an arm, heads turn.
// Render: python folio.py render assets/folio/examples/people_walk.js --dur 4
FOLIO.scene({ build(S) {
  const F = FOLIO;
  // a plain Dayton sidewalk: far wall, pavement, kerb
  const bg = S.layer({ p: 0.6, name: "wall", blur: 1.5 });
  bg.add(`<rect x="-300" y="-200" width="2600" height="1100" fill="${F.lg(bg.defs, ["#B98C74", "#9E6F5C"])}"/>`);
  for (let i = 0; i < 9; i++) bg.add(`<rect x="${-160 + i * 290}" y="170" width="170" height="430" rx="6" fill="#6F5A63" opacity="0.75"/>`);
  const ground = S.layer({ p: 1, name: "ground" });
  ground.add(`<rect x="-300" y="820" width="2600" height="400" fill="${F.lg(ground.defs, ["#BFA98C", "#A58F74"])}"/>
    <rect x="-300" y="812" width="2600" height="10" fill="#8E7A64"/>`);
  const cast = S.layer({ p: 1, name: "cast" });
  const wilbur = { id: "wilbur", sex: "m", build: "slim", hair: { style: "balding", color: "#4A3426" }, eyes: "#6F92B4",
    outfit: { kind: "suit", main: "#3B4151" }, hat: "flatcap" };
  const orville = { id: "orville", sex: "m", build: "slim", hair: { style: "bob", color: "#4E3526" }, eyes: "#7C8A8E",
    facial: { moustache: "walrus" }, outfit: { kind: "suit", main: "#665543", accent: "#7A2230" }, hat: "bowler" };
  const O = S.person(orville, cast, { x: -460, y: 960, h: 640, face: "right" });
  const W = S.person(wilbur, cast, { x: -150, y: 960, h: 640, face: "right" });
  W.walk(0, 2.7, -150, 1060);
  O.walk(0.2, 2.9, -460, 700);
  W.look([1500, 250], 2.5, 0.5);
  W.pose("raise", 2.75, 0.55);
  W.expr("smile", 2.9);
  O.look([1140, 330], 3.0, 0.35);
  O.look([1200, 180], 3.4, 0.3);
  O.expr("surprised", 3.3);
  S.cam([{ t: 0, x: 960, y: 560, zoom: 1.0 }, { t: 4, x: 1000, y: 560, zoom: 1.04 }]);
}});
