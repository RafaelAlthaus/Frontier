// lib/nature — terrain biomes + features, water, vegetation and rocks, creatures, space (see world.js header).
// The core loads every module listed here (paths relative to this file); each exports CATALOG + build(kind, item, ctx),
// world.js also exports buildWorld(world, look, ctx).
export const MODULES = ['./world.js', './water.js', './flora.js', './creatures.js', './space.js', './smallcritters.js', './sealife.js',
  './planets.js', './planetworlds.js', './giants.js'];   // E4 v2: the Solar System bodies (planets.js), other worlds' surfaces (planetworlds.js) and cloud decks (giants.js)
