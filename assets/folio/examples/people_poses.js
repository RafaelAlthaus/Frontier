// FOLIO people demo — one character cycles through every pose (1.25 s each, 0.45 s blends).
// Render: python folio.py render assets/folio/examples/people_poses.js --dur 25
FOLIO.scene({ build(S) {
  const F = FOLIO;
  const wall = S.layer({ p: 0.8, name: "wall" });
  wall.add(`<rect x="-300" y="-200" width="2600" height="1200" fill="${F.lg(wall.defs, ["#CDBCA2", "#B7A083"])}"/>`);
  const floor = S.layer({ p: 1, name: "floor" });
  floor.add(`<rect x="-300" y="900" width="2600" height="400" fill="${F.lg(floor.defs, ["#A88D6E", "#8E7458"])}"/><rect x="-300" y="896" width="2600" height="8" fill="#7E6650"/>`);
  const furn = S.layer({ p: 1, name: "furniture" });
  const cast = S.layer({ p: 1, name: "cast" });
  const desk = S.layer({ p: 1, name: "desk" });
  const orville = { id: "orville", sex: "m", build: "slim", eyes: "#7C8A8E", hair: { style: "bob", color: "#4E3526" },
    facial: { moustache: "walrus" }, outfit: { kind: "suit", main: "#665543", accent: "#7A2230" } };
  const X = 900, Y = 900, Hh = 600;
  const P = S.person(orville, cast, { x: X, y: Y, h: Hh, face: "right", pose: "stand" });
  const poses = ["stand", "walk", "run", "point", "raise", "reach", "hold", "think", "crossed", "sit", "write", "kneel",
                 "crouch", "lie", "wave", "hammer", "look-up", "shrug", "present", "ride"];
  const T = 1.25;
  poses.forEach((n, i) => { if (i) P.pose(n, i * T, 0.45); });
  // a stool for sit / write, a desk for write, a hammer for hammer, a bicycle for ride — shown only then
  const on = (node, a, b) => S.on((t) => { node.style.opacity = Math.min(F.smooth(F.seg(t, a, a + 0.25)), 1 - F.smooth(F.seg(t, b - 0.2, b))).toFixed(3); });
  const iSit = poses.indexOf("sit"), iWrite = poses.indexOf("write");
  const seat = P.seatAt(iSit * T + 1);
  on(furn.add(`<rect x="${seat[0] - 150}" y="${seat[1]}" width="150" height="${Y - seat[1]}" fill="#8A6A4A" stroke="#5A3E26" stroke-width="3"/>`), iSit * T, (iWrite + 1) * T);
  on(desk.add(`<rect x="${X + 40}" y="${seat[1] - 120}" width="330" height="16" fill="#9A6E48" stroke="#5A3E26" stroke-width="3"/><rect x="${X + 330}" y="${seat[1] - 104}" width="16" height="${Y - seat[1] + 104}" fill="#7A5438"/>`), iWrite * T, (iWrite + 1) * T);
  const pencil = F.svg(`<rect x="-3" y="-2" width="62" height="6" rx="2" fill="#D9B45E" stroke="#6A4A1E" stroke-width="1.5"/>`, P.hand("right", { grip: false }));
  on(pencil, iWrite * T + 0.2, (iWrite + 1) * T);
  const iHam = poses.indexOf("hammer");
  const hammer = F.svg(`<g><rect x="-22" y="-6" width="118" height="12" rx="4" fill="#9A6A3A" stroke="#5A3A1A" stroke-width="2.4"/><rect x="92" y="-30" width="28" height="60" rx="4" fill="#5A5A60" stroke="#2E2E34" stroke-width="2.4"/></g>`, P.hand("right"));
  on(hammer, iHam * T + 0.2, (iHam + 1) * T);
  const iRide = poses.indexOf("ride");
  const bike = F.el("g", null, furn.g); on(bike, iRide * T + 0.1, 99);
  const k = Hh / 1000, wheelR = 0.215 * Hh;
  const rearW = F.el("circle", { r: wheelR, fill: "none", stroke: "#2E2A28", "stroke-width": 7 }, bike);
  const frontW = F.el("circle", { r: wheelR, fill: "none", stroke: "#2E2A28", "stroke-width": 7 }, bike);
  const frame = F.el("path", { fill: "none", stroke: "#3A3432", "stroke-width": 7, "stroke-linejoin": "round", "stroke-linecap": "round" }, bike);
  const crank = F.el("path", { stroke: "#6A6A70", "stroke-width": 6, "stroke-linecap": "round" }, bike);
  S.on((t) => {
    if (t < iRide * T) return;
    const B = P.bikeAt(t), s = B.m * B.k;
    const rear = [B.crank[0] - 390 * s, Y - wheelR], fr = [B.crank[0] + 430 * s, Y - wheelR], head = [B.bar[0] - 30 * s, B.bar[1] + 60 * k];
    rearW.setAttribute("cx", rear[0]); rearW.setAttribute("cy", rear[1]); frontW.setAttribute("cx", fr[0]); frontW.setAttribute("cy", fr[1]);
    frame.setAttribute("d", `M${rear} L${B.crank} L${B.seat} Z M${B.crank} L${head} L${B.seat} M${head} L${fr} M${B.bar} L${head} M${B.seat[0] - 40 * s},${B.seat[1]} L${B.seat[0] + 30 * s},${B.seat[1]}`);
    crank.setAttribute("d", `M${B.pedals[0]} L${B.pedals[1]}`);
  });
  P.face("profile-right", iRide * T);
  poses.forEach((n, i) => {
    const d = S.div("hud", "sans", n);
    Object.assign(d.style, { left: "90px", top: "70px", fontSize: "44px", color: "#4A382A", opacity: 0 });
    on(d, i * T + 0.05, i === poses.length - 1 ? 99 : (i + 1) * T);
  });
  P.expr("smile", 4 * T); P.expr("focused", 10 * T); P.expr("neutral", 12 * T); P.expr("surprised", 16 * T); P.expr("worried", 17 * T); P.expr("smile", 18 * T);
  P.look("up", 16 * T, 0.4); P.look("ahead", 17 * T, 0.4);
}});
