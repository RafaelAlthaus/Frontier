// Example shot — "Every one of them owes its wings to two brothers from Dayton, Ohio, neither of whom had a high
// school diploma." The reference's Dayton street: a one-point-perspective street c. 1900 in hazy morning sun, the two
// brothers walk in on the sidewalk and stop; the place label lands on "Dayton", each name on its person, and the
// diploma they never had appears over them and is struck through in red. The camera eases back to reveal the street.
FOLIO.scene({ build(S) {
  const F = FOLIO;
  const tBro = S.at("two brothers", 0.25), tDay = S.at("Dayton", 0.45), tNei = S.at("neither", 0.7);
  const tDip = S.at("diploma", 0.9);

  // the whole street in one call; people stand on its ground layer
  const st = S.set.stage("street", { time: "day", seed: 4 });
  const L = st.ground, y = st.floor + 70;

  // the cast (the film's definitions come from S.cast; written out here so the example runs on its own)
  const wilbur = S.cast.wilbur || { id: "wilbur", sex: "m", build: "slim", hair: { style: "sidepart", color: "#4A3426" },
    eyes: "#6F92B4", outfit: { kind: "suit", main: "#3B4151" }, hat: "flatcap" };
  const orville = S.cast.orville || { id: "orville", sex: "m", build: "slim", hair: { style: "bob", color: "#4E3526" },
    eyes: "#7C8A8E", facial: { moustache: "walrus" }, outfit: { kind: "suit", main: "#665543", accent: "#7A2230" }, hat: "bowler" };
  const O = S.person(orville, L, { x: -260, y, h: 600, face: "right" });
  const W = S.person(wilbur, L, { x: -520, y: y + 12, h: 612, face: "right" });
  // they walk in and stop as "two brothers" is said, then look at each other
  O.walk(0.1, tBro + 0.4, -260, 720);
  W.walk(0.0, tBro + 0.2, -520, 420, y + 12, y + 12);
  W.look([720, y - 560], tBro + 0.5, 0.4);
  O.look([420, y - 560], tBro + 0.9, 0.4);
  O.look("camera", tDip - 0.2, 0.4);

  // words: the place on "Dayton", each name on its person
  S.place("Dayton, Ohio", { at: tDay });
  S.name("Wilbur Wright", { target: W, at: tDay + 0.35 });
  S.name("Orville Wright", { target: O, at: tDay + 0.7 });

  // the diploma they never had: a rolled certificate with a red ribbon, struck through on "diploma"
  const top = S.layer({ p: 1, name: "diploma" });
  const dip = F.svg(`
    <rect x="-120" y="-34" width="240" height="68" rx="34" fill="${F.lg(top.defs, ["#FBF3DD", "#E4D5B0"])}" stroke="${F.ink("#E4D5B0")}" stroke-width="3"/>
    <ellipse cx="-120" cy="0" rx="16" ry="34" fill="#EFE3C4" stroke="${F.ink("#E4D5B0")}" stroke-width="3"/>
    <rect x="-18" y="-36" width="36" height="72" fill="#B8433A"/>
    <path d="M -10 34 L -22 78 L -4 66 L 6 82 L 12 34 Z" fill="#9C3830"/>`, top.g);
  const strike = F.el("path", { d: "M -170 40 L 170 -40", stroke: "#C13A29", "stroke-width": 12, "stroke-linecap": "round", fill: "none" }, dip);
  const len = strike.getTotalLength();
  strike.setAttribute("stroke-dasharray", `${len} ${len}`);
  S.on((t) => {
    const a = F.eBack(F.seg(t, tNei, tNei + 0.45), 1.6), s = F.eOut(F.seg(t, tDip, tDip + 0.3));
    F.tf(dip, { x: 575, y: 260 - (1 - a) * 30, s: 0.95 * a + 0.05 });
    dip.setAttribute("opacity", F.seg(t, tNei, tNei + 0.2));
    strike.setAttribute("stroke-dashoffset", (len * (1 - s)).toFixed(1));
  });

  // a slow pull-back reveal, then the street holds
  S.cam([{ t: 0, x: 900, y: 560, zoom: 1.16 }, { t: Math.min(2.4, S.dur * 0.45), x: 940, y: 545, zoom: 1.0, e: "smooth" }, { t: S.dur, x: 944, y: 545, zoom: 0.99 }]);
}});
