// lib/fx — disaster FX for Frontier 3D ("How Long You'd Last in Every Natural Disaster").
// Two artists share this index. APPEND your own entries to MODULES; never rewrite or reorder the other artist's.
//   D2a (weather & water): files prefixed w_   (fx.lightning, fx.avalanche, fx.tornado, fx.hurricane, fx.tsunami, fx.megatsunami)
//   D2b (fire, earth & space): files prefixed f_   (fx.wildfire, fx.quake, fx.eruption, fx.pyroclastic, fx.ashmap, fx.impact, fx.grb;
//                              f_common.js is shared machinery, not a module)
// Entries are paths relative to this file. The core registry imports each one on its own, so a missing or broken
// module never takes the others down (it is warned and skipped).
export const MODULES = [
  // ── D2a weather & water ──
  './w_lightning.js', './w_avalanche.js', './w_tornado.js', './w_hurricane.js', './w_tsunami.js', './w_megatsunami.js',
  // ── D2b fire, earth & space (append below) ──
  './f_wildfire.js', './f_quake.js', './f_volcano.js', './f_ashmap.js', './f_space.js',
  // ── E2 (v2) sea disaster: iceberg, distress rockets, people and wreckage in the water ──
  './e2_sea.js', './e2_wreck.js', './e2_under.js', './e2_deep.js',
];
