// biomes.js — the look and the ecology of every world.biome. Colours are sRGB hex (linearised on use).
//   shape     which height generator world.js uses          relief   default relief (0 flat .. 1 dramatic)
//   soil/grass/dry/rock/sand palettes (grass per season)      lush     how much of the flat ground is vegetated
//   rockSlope slope (1 - n.y) where bare rock takes over      snow     0..1 cover, snowLine metres above the stage
//   flora     [kind, trees per hectare near the stage, rule]   mood     hints for the core's env (fog, haze, tint)
// Seasons: spring | summer | autumn | winter (default summer; snowfield/arctic force winter).

export const SEASONS = ['spring', 'summer', 'autumn', 'winter'];

const TEMPERATE_GRASS = {
  spring: ['#5f7f2c', '#7a9637', '#8d9a44'], summer: ['#4f6b25', '#6b7f2e', '#8f8a45'],
  autumn: ['#6a6a2e', '#86743a', '#8e6c38'], winter: ['#5d5a3c', '#6e6646', '#7a6f55'],
};

export const BIOMES = {
  plains: {
    desc: 'open rolling grassland under a big sky, lone trees and copses, far low hills', shape: 'rolling', relief: 0.45,
    soil: ['#6b5a44', '#7d6a50'], grass: TEMPERATE_GRASS, rock: '#8d887e', lush: 0.95, rockSlope: 0.5, snow: 0,
    flora: [['grass', 1, 'open'], ['deciduous', 14, 'copse'], ['bush', 10, 'copse'], ['rock', 0.25, 'any']],
    forest: 0.08, mood: { haze: 1.0 },
  },
  farmland: {
    desc: 'patchwork of fields (wheat, pasture, ploughed soil) with hedgerows, lanes and copses', shape: 'rolling', relief: 0.25,
    soil: ['#6a5238', '#7a6044'], grass: TEMPERATE_GRASS, rock: '#8d887e', lush: 1.0, rockSlope: 0.5, snow: 0, fields: true,
    flora: [['grass', 0.6, 'margin'], ['bush', 3000, 'margin'], ['deciduous', 60, 'margin'], ['deciduous', 10, 'copse'], ['bush', 6, 'copse']],
    forest: 0.05, mood: { haze: 1.0 },
  },
  forest: {
    desc: 'dense woodland on rolling hills: conifers or deciduous by season, forest floor, clearings', shape: 'hills', relief: 0.45,
    soil: ['#4a3a2a', '#5a4632'], grass: TEMPERATE_GRASS, rock: '#7f7b72', lush: 0.8, rockSlope: 0.5, snow: 0,
    flora: [['conifer', 130, 'forest'], ['deciduous', 90, 'forest'], ['bush', 30, 'forest'], ['fern', 120, 'forest'], ['grass', 0.5, 'open'], ['rock', 1, 'any']],
    forest: 0.85, mood: { haze: 1.2 },
  },
  snowfield: {
    desc: 'deep fresh snow over rolling ground, snow-laden spruce woods, drifts, sparkle', shape: 'hills', relief: 0.35,
    soil: ['#5a5040', '#6a6050'], grass: TEMPERATE_GRASS, rock: '#77746e', lush: 0.2, rockSlope: 0.6, snow: 1, forceSeason: 'winter',
    flora: [['conifer', 170, 'forest'], ['conifer', 1.2, 'any'], ['bush', 2, 'copse'], ['rock', 0.4, 'any']],
    forest: 0.35, mood: { haze: 1.3, tint: 'cold' },
  },
  desert: {
    desc: 'sand sea of crescent dunes with sharp crests and wind ripples, heat haze, rare rock', shape: 'dunes', relief: 0.75,
    soil: ['#d2a468', '#e0b880'], grass: { summer: ['#8a7a4a', '#9a8a55', '#a89262'] }, rock: '#a2765a', sand: ['#e2b67a', '#efca92'],
    lush: 0.0, rockSlope: 0.75, snow: 0, sandy: 1,
    flora: [['rock', 0.05, 'any']], forest: 0, mood: { haze: 1.6, tint: 'warm' },
  },
  jungle: {
    desc: 'steamy tropical rainforest on steep hills: giant broadleaf trees, palms, tree ferns, dense understory', shape: 'hills', relief: 0.6,
    soil: ['#3e2e1e', '#4e3a26'], grass: { summer: ['#3e6a1e', '#4f7a22', '#5d8428'] }, rock: '#6a6a5e', lush: 1.0, rockSlope: 0.62, snow: 0,
    flora: [['broadleaf', 45, 'forest'], ['palm', 18, 'forest'], ['treefern', 30, 'forest'], ['fern', 90, 'forest'], ['bush', 25, 'forest']],
    forest: 0.9, mood: { haze: 2.2, tint: 'humid' },
  },
  mountains: {
    desc: 'alpine valley: meadow floor, scree, rock faces, snow-capped peaks rising 1-2 km', shape: 'mountains', relief: 0.8,
    soil: ['#5e5446', '#6e6252'], grass: TEMPERATE_GRASS, rock: '#86827a', lush: 0.75, rockSlope: 0.42, snow: 0.8, snowLine: 420,
    flora: [['conifer', 140, 'forest'], ['grass', 0.8, 'open'], ['rock', 2.5, 'any'], ['boulder', 0.4, 'any']],
    forest: 0.45, mood: { haze: 0.8 },
  },
  coast: {
    desc: 'a beach and chalk-sandstone cliffs meeting the open ocean, dune grass, surf', shape: 'coast', relief: 0.5,
    soil: ['#6e6048', '#7e6e54'], grass: TEMPERATE_GRASS, rock: '#b3a58e', sand: ['#d8c49c', '#e6d4ae'], lush: 0.85, rockSlope: 0.45, snow: 0,
    flora: [['grass', 1, 'open'], ['bush', 1.5, 'copse'], ['rock', 0.6, 'shore'], ['boulder', 0.3, 'shore']],
    forest: 0.04, water: 'ocean', mood: { haze: 1.3 },
  },
  river_valley: {
    desc: 'a broad green valley floor with a meandering river, reeds, trees along the banks, hills either side', shape: 'valley', relief: 0.5,
    soil: ['#5e4e3a', '#6e5a44'], grass: TEMPERATE_GRASS, rock: '#8a857a', lush: 1.0, rockSlope: 0.5, snow: 0,
    flora: [['grass', 1, 'open'], ['deciduous', 3, 'bank'], ['bush', 3, 'bank'], ['reeds', 40, 'shallows'], ['deciduous', 12, 'forest'], ['conifer', 6, 'forest']],
    forest: 0.25, water: 'river', mood: { haze: 1.2 },
  },
  volcanic: {
    desc: 'black basalt lava fields, ash plains, steaming vents, a smoking volcano on the horizon', shape: 'volcanic', relief: 0.55,
    soil: ['#2a2624', '#3a3430'], grass: { summer: ['#4a4a30', '#5a5236', '#6a5e40'] }, rock: '#3a3632', lush: 0.05, rockSlope: 0.35, snow: 0, lava: 0.6,
    flora: [['boulder', 0.8, 'any'], ['rock', 3, 'any']], forest: 0, mood: { haze: 1.6, tint: 'ash' },
  },
  arctic_ice: {
    desc: 'a white ice sheet under a low sun: sastrugi, pressure ridges, blue ice', shape: 'ice', relief: 0.25,
    soil: ['#b9c4cc', '#c9d2d8'], grass: TEMPERATE_GRASS, rock: '#8fa6b8', lush: 0, rockSlope: 0.7, snow: 1, forceSeason: 'winter', ice: 1,
    flora: [], forest: 0, mood: { haze: 1.1, tint: 'cold' },
  },
  moon_surface: {
    desc: 'grey regolith plains pocked with craters, hard black shadows, black sky with Earth', shape: 'moon', relief: 0.45,
    soil: ['#7a7874', '#8a8884'], grass: { summer: ['#7a7874', '#7a7874', '#7a7874'] }, rock: '#6a6864', lush: 0, rockSlope: 0.6, snow: 0,
    flora: [['boulder', 0.2, 'any'], ['rock', 2, 'any']], forest: 0, sky: 'space', mood: { haze: 0, fog: 0 },
  },
  mars: {
    desc: 'rust-red desert of dunes, craters and far mesas under a butterscotch sky', shape: 'mars', relief: 0.5,
    soil: ['#9a5a36', '#b06a40'], grass: { summer: ['#9a5a36', '#9a5a36', '#9a5a36'] }, rock: '#7a4a32', sand: ['#b87048', '#c47a50'],
    lush: 0, rockSlope: 0.5, snow: 0, sandy: 0.6,
    flora: [['rock', 2.5, 'any'], ['boulder', 0.3, 'any']], forest: 0, sky: 'mars', mood: { haze: 1.4, tint: 'mars' },
  },
  ocean: { desc: 'open sea to every horizon, Gerstner swell, glitter', shape: 'none', water: 'ocean', relief: 0, flora: [], mood: { haze: 1.1 } },
  open_sea: { alias: 'ocean' },
  space: { desc: 'no ground: stars, the Milky Way, planets', shape: 'none', flora: [], sky: 'space', mood: { haze: 0, fog: 0 } },
};

export function biomeOf(name) {
  let b = BIOMES[name];
  if (b && b.alias) b = BIOMES[b.alias];
  return b || null;
}
