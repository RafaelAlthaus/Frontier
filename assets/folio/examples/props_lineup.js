// FOLIO demo — every prop in props.js on one sheet, animated (spin, walk, flap, flicker, rock).
FOLIO.scene({ build(S) {
  const F = FOLIO;
  const bg = S.layer({ p: 0.2, name: "bg" });
  bg.add(`<rect x="-900" y="-900" width="3720" height="2880" data-cover="1" fill="${F.lg(bg.defs, ["#F1EBDC", "#DCD2BC"])}"/>`);
  const L = S.layer({ p: 1, name: "props" });
  const cols = 9, cw = 1920 / cols, rh = 176, top = 8;
  const items = [
    ["book", "book", { state: "closed" }, 1.3], ["books", "book", { state: "stack" }, 1.0], ["open book", "book", { state: "open" }, 1.3],
    ["scroll", "scroll", { open: 1, len: 260 }, 0.72], ["scroll (rolled)", "scroll", { open: 0 }, 0.75], ["inkpot + quill", "inkpot", {}, 0.52],
    ["map", "map", {}, 0.42], ["letter", "letter", {}, 0.75], ["coins", "coins", {}, 1.2], ["oil lamp (parlour)", "lamp", { kind: "parlour", glow: 150 }, 0.55],
    ["oil lamp (ancient)", "lamp", { kind: "ancient" }, 1.2], ["desk lamp", "lamp", { kind: "desk" }, 0.75], ["candle", "candle", {}, 1.0], ["torch", "torch", { smoke: false }, 0.55],
    ["lantern", "lantern", {}, 0.85], ["table", "table", { kind: "work" }, 0.42], ["round table", "table", { kind: "round" }, 0.42], ["chair", "chair", {}, 0.5],
    ["armchair", "chair", { kind: "armchair" }, 0.5], ["crate", "crate", { label: "No. 3" }, 0.62], ["barrel", "barrel", {}, 0.52], ["tent", "tent", {}, 0.3],
    ["amphora", "amphora", {}, 0.58], ["clay jar", "amphora", { kind: "jar" }, 0.8], ["basket", "basket", { contents: "fruit" }, 0.8], ["rope", "rope", { coil: true }, 0.95],
    ["ladder", "ladder", { lean: 10 }, 0.18], ["sundial", "sundial", { hour: 10 }, 0.45], ["gnomon", "gnomon", {}, 1], ["measuring rod", "rod", {}, 1],
    ["abacus", "abacus", {}, 0.44], ["globe", "globe", { spin: 20 }, 0.47], ["telescope", "telescope", {}, 0.34], ["compass", "compass", {}, 0.8],
    ["dividers", "compass", { kind: "dividers" }, 0.55], ["sailing ship", "ship", { kind: "merchant" }, 0.27], ["galley", "ship", { kind: "galley" }, 0.26],
    ["galleon", "ship", { kind: "galleon" }, 0.2], ["felucca", "ship", { kind: "felucca" }, 0.28], ["steamer", "ship", { kind: "steamer" }, 0.25],
    ["cart", "cart", { load: "hay", spin: 0.3 }, 0.36], ["chariot", "cart", { kind: "chariot", spin: 0.4 }, 0.42],
  ];
  const second = [
    ["horse (walk)", "horse", { walk: 0.9 }, 0.24], ["camel (walk)", "camel", { walk: 0.8, saddle: true }, 0.22], ["hawk", "bird", { kind: "hawk", flap: 0 }, 0.45],
    ["gull (flap)", "bird", { kind: "gull", flap: 2 }, 0.45], ["toy helicopter", "toy", { spin: [[0, 0.4], [4, 6]] }, 0.5], ["kite", "toy", { kind: "kite" }, 0.5],
    ["bicycle", "bicycle", { spin: 0.5 }, 0.44], ["satellite", "satellite", { spin: 6 }, 0.38], ["sputnik", "satellite", { kind: "sputnik" }, 0.4],
    ["airliner", "airliner", { contrail: false }, 0.28], ["wagon", "cart", { kind: "wagon", cover: true, spin: 0.3 }, 0.3], ["flock", "flock", {}, 1],
  ];
  const all = items.concat(second);
  all.forEach(([label, fn, opt, s], i) => {
    const c = i % cols, r = Math.floor(i / cols);
    const x = cw * (c + 0.5), y = top + rh * (r + 1) - 34;
    if (fn === "rod") { S.prop.rod(L, Object.assign({ x, y: y - 50, len: 220, r: -8, thick: 14 }, opt)); }
    else if (fn === "gnomon") { S.prop.gnomon(L, { x: x - 50, y: y - 16, h: 110, sun: { elev: 40, dir: 10 }, ray: true, angle: true, track: [{ t: 0, elev: 30, dir: 0 }, { t: 6, elev: 70, dir: 40 }] }); }
    else if (fn === "flock") { S.prop.flock(L, { area: [x - 110, y - 120, 200, 80], n: 7 }); }
    else if (fn === "bird") { S.prop.bird(L, Object.assign({ x, y: y - 70, s }, opt)); }
    else if (fn === "satellite") { S.prop.satellite(L, Object.assign({ x, y: y + 10, s }, opt)); }
    else if (fn === "airliner") { S.prop.airliner(L, Object.assign({ x, y: y - 70, s }, opt)); }
    else if (fn === "ship") { S.prop.ship(L, Object.assign({ x, y: y - 20, s, waterColor: "#9FC6CC" }, opt)); }
    else S.prop[fn](L, Object.assign({ x, y, s }, opt));
    L.add(`<text x="${x}" y="${y + 24}" text-anchor="middle" font-family="EB Garamond, serif" font-size="17" fill="#6B5A44">${label}</text>`);
  });
}});
