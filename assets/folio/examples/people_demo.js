// FOLIO people demo — the cast line-up: two brothers in 1900s suits, an old Greek scholar, an Egyptian worker,
// a woman in a 1900s dress and a child, each in a pose, all changing pose at 2.6 s.
// Stills: python folio.py still assets/folio/examples/people_demo.js --dur 6 --t 0.5,3 --scale 0.5
FOLIO.scene({ build(S) {
  const F = FOLIO;
  // a warm studio wall with one key light (upper left) and a floor
  const wall = S.layer({ p: 0.7, name: "wall" });
  wall.add(`<rect x="-300" y="-200" width="2600" height="1200" fill="${F.lg(wall.defs, ["#C9B79A", "#B39B7C"])}"/>
    <ellipse cx="420" cy="260" rx="760" ry="520" fill="${F.rg(wall.defs, [[0, "#FFF1D6", 0.55], [1, "#FFF1D6", 0]])}"/>`);
  const floor = S.layer({ p: 1, name: "floor" });
  floor.add(`<rect x="-300" y="905" width="2600" height="400" fill="${F.lg(floor.defs, ["#A88D6E", "#8E7458"])}"/>
    <rect x="-300" y="900" width="2600" height="8" fill="#7E6650"/>`);
  const cast = S.layer({ p: 1, name: "cast" });

  const wilbur = { id: "wilbur", sex: "m", age: "adult", build: "slim", skin: "#F2CBAC", eyes: "#6F92B4",
    hair: { style: "balding", color: "#4A3426" }, outfit: { kind: "suit", main: "#3B4151", accent: "#2B2730" }, hat: "flatcap" };
  const orville = { id: "orville", sex: "m", age: "adult", build: "slim", eyes: "#7C8A8E",
    hair: { style: "bob", color: "#4E3526" }, facial: { moustache: "walrus" },
    outfit: { kind: "suit", main: "#665543", accent: "#7A2230" }, hat: "bowler" };
  const scholar = { id: "plato", sex: "m", age: "old", build: "average", hair: { style: "balding", color: "#E4E0D8" },
    facial: { beard: "long", moustache: "walrus", color: "#ECE8E0" }, outfit: { kind: "toga", main: "#EFE8D6", second: "#D9CDB0" }, footwear: "sandals" };
  const worker = { id: "egypt-worker", sex: "m", age: "young", build: "average", skin: "#C98E62", eyes: "#4A3222",
    hair: { style: "short", color: "#1E1612" }, outfit: { kind: "kilt", main: "#EEE8D8", accent: "#3D7A8B" }, hat: "headcloth", footwear: "bare" };
  const lady = { id: "lady", sex: "f", age: "adult", hair: { style: "bun", color: "#6A4630" }, eyes: "#5E7E5A",
    outfit: { kind: "dress", main: "#5E4A72", second: "#F2EDE3", accent: "#3D2E47" } };
  const kid = { id: "boy", sex: "m", age: "child", hair: { style: "bob", color: "#5A3C28" },
    outfit: { kind: "shirt", main: "#5B4636", second: "#E8E2D4", accent: "#6A4A32" } };

  const y = 912;
  const W = S.person(wilbur, cast, { x: 190, y, h: 560, face: "right", pose: "think" });
  const O = S.person(orville, cast, { x: 470, y, h: 560, face: "right", pose: "crossed" });
  const P = S.person(scholar, cast, { x: 790, y, h: 540, face: "right", pose: "present" });
  const E = S.person(worker, cast, { x: 1110, y, h: 570, face: "left", pose: "stand" });
  const L = S.person(lady, cast, { x: 1420, y, h: 520, face: "left", pose: "wave" });
  const K = S.person(kid, cast, { x: 1700, y, h: 400, face: "left", pose: "reach" });

  // at 2.6 s everyone changes pose (0.6 s blends)
  W.pose("hold", 2.6, 0.6); W.look("down", 2.7, 0.4); W.expr("focused", 2.8);
  O.pose("point", 2.6, 0.6); O.look([2000, 560], 2.6, 0.4); O.expr("determined", 2.8);
  P.pose("raise", 2.6, 0.7); P.look("up", 2.8, 0.5); P.expr("smile", 2.9);
  E.pose("raise", 2.6, 0.7); E.expr("focused", 2.8);
  L.pose("present", 2.6, 0.6); L.look("left", 2.7, 0.4); L.expr("smile", 2.7);
  K.pose("look-up", 2.6, 0.6); K.expr("surprised", 2.7);
  O.talk(3.2, 4.4);


  // props: a cardboard box for Wilbur, a scroll for the scholar, a basket for the worker
  const bw = W.span(4) / 2 + 26;         // half the distance between the palms once "hold" is reached (ask after scheduling the pose), plus the ends
  const box = F.svg(`<rect x="${-bw}" y="-26" width="${2 * bw}" height="52" rx="3" fill="#D9B77E" stroke="#8A6A3A" stroke-width="3"/>
    <path d="M${4 - bw} -9L${bw - 4} -9M${4 - bw} 9L${bw - 4} 9" stroke="#B08A50" stroke-width="2"/>`, W.between());
  S.fade(box, 2.55, 2.8);
  box.style.opacity = 0;
  const scroll = F.svg(`<g><rect x="-10" y="-58" width="20" height="116" rx="8" fill="#EADDBA" stroke="#9A8558" stroke-width="2.4"/>
    <rect x="-14" y="-64" width="28" height="10" rx="4" fill="#9A6A3A"/><rect x="-14" y="54" width="28" height="10" rx="4" fill="#9A6A3A"/></g>`, P.hand("left", { upright: true }));
  scroll.style.opacity = 0; S.fade(scroll, 2.6, 2.9);
  const basket = F.svg(`<g transform="translate(0 -40)"><path d="M-60 -10L60 -10L48 34L-48 34Z" fill="#C9A060" stroke="#7A5A2A" stroke-width="3"/>
    <path d="M-54 6L54 6M-50 20L50 20" stroke="#9A7440" stroke-width="2"/><ellipse cx="0" cy="-12" rx="62" ry="10" fill="#B08848" stroke="#7A5A2A" stroke-width="3"/></g>`, E.hand("left", { upright: true }));
  basket.style.opacity = 0; S.fade(basket, 2.6, 2.9);

  // name labels, if the hud library is loaded
  if (S.name) [[W, "Wilbur"], [O, "Orville"], [P, "the scholar"], [E, "a worker"], [L, "Katharine"], [K, "a boy"]]
    .forEach(([who, n], i) => S.name(n, { target: who, at: 0.3 + i * 0.1, size: 40 }));
}});
