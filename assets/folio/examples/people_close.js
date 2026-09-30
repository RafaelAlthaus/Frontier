// FOLIO people demo — medium close-up: the camera is pushed in so Wilbur's head is ~280 px tall.
// Expressions change on a beat, he blinks on his own (plus one scripted blink), looks around and talks.
// Stills: python folio.py still assets/folio/examples/people_close.js --dur 8 --t 0.5,1.5,2.5,3.5,4.5,5.5,6.5,7.5
FOLIO.scene({ build(S) {
  const F = FOLIO;
  // a workshop in the background, far out of focus (bokeh of a window and a lamp)
  const back = S.layer({ p: 0.35, name: "back", blur: 14 });
  back.add(`<rect x="-600" y="-400" width="3200" height="1900" fill="${F.lg(back.defs, ["#8C6A54", "#5E4638"])}"/>
    <rect x="1080" y="-80" width="520" height="560" fill="#E9D8B8" opacity="0.55"/><rect x="1330" y="-80" width="16" height="560" fill="#7A5A44"/>
    <circle cx="560" cy="180" r="90" fill="#FFE2A8" opacity="0.5"/><rect x="-200" y="720" width="2600" height="700" fill="#6A4E3C"/>`);
  const cast = S.layer({ p: 1, name: "cast" });
  const wilbur = { id: "wilbur", sex: "m", age: "adult", build: "slim", eyes: "#6F92B4",
    hair: { style: "balding", color: "#4A3426" }, outfit: { kind: "suit", main: "#3B4151" } };
  const W = S.person(wilbur, cast, { x: 900, y: 1000, h: 640, face: "right", pose: "stand" });
  // push in on the face: the head (0.172 h = 110 px) becomes ~280 px at zoom 2.55
  const head = W.headAt(0);
  S.cam([{ t: 0, x: head[0] + 150, y: head[1] + 118, zoom: 2.7 }, { t: 8, x: head[0] + 140, y: head[1] + 118, zoom: 2.82 }]);
  const E = ["neutral", "smile", "surprised", "worried", "focused", "sad", "laugh", "determined"];
  E.forEach((e, i) => W.expr(e, 0.2 + i * 1.0, 0.3));
  W.look("camera", 1.3, 0.35);
  W.look("up", 2.3, 0.4);
  W.look("down", 3.3, 0.35);
  W.look("left", 4.3, 0.4);
  W.look([1600, 330], 5.2, 0.4);
  W.look("right", 6.4, 0.3);
  W.talk(5.1, 6.1);
  W.blink(3.6);
  // the name of each expression, bottom left (one visibility updater per label)
  E.forEach((e, i) => {
    const d = S.div("hud", "sans", e), a = 0.2 + i * 1.0, b = 1.15 + i * 1.0;
    Object.assign(d.style, { left: "80px", bottom: "70px", fontSize: "34px", color: "#F5EBDD", opacity: 0, textShadow: "0 2px 8px rgba(0,0,0,.4)" });
    S.on((t) => { d.style.opacity = Math.min(F.smooth(F.seg(t, a, a + 0.2)), 1 - F.smooth(F.seg(t, b - 0.15, b))).toFixed(3); });
  });
}});
