# Frontier 3D engine

A three.js page that renders documentary scenes from JSON specs, driven by `../render.py`. It is self-contained:
the page imports only files under `engine/` (the import map points `three` at `vendor/three`).

## Running it
```
/usr/bin/python3 render.py video.json OUTDIR [--scenes s01,s03] [--quality draft|final]   # OUTDIR/<id>.mp4 + report.json
/usr/bin/python3 render.py video.json OUTDIR --preview 1.5,6 [--w 960 --h 540]             # stills, with QA per still
/usr/bin/python3 render.py --catalog catalog.json                                           # merged catalog for the director
```
`render.py` serves `engine/` on a free local port and runs one Chromium with the GPU (Metal ANGLE on macOS,
the default D3D11 ANGLE on Windows) under the GPU lock. It loads the page once per job and closes it afterwards.
The segments are 1080p30, libx264 crf 16, yuv420p, limited-range BT.709, tagged.
`--eval "<js>"` (with `--preview`) evaluates an expression after each scene loads, for debugging (`f3d` = `window.__f3d`).

## Spec
See `../DESIGN.md` for the full scene spec. Examples covering every camera template on the core fallback world are in
`../examples/core_*.json`, and `core_all.json` holds all of them. The engine reads these parts:
- `look`: `time` dawn|morning|noon|afternoon|golden|dusk|night|overcast (sets the sun, placed side-back to the mean
  camera direction unless `sun: {az, el}` is given), `sky` clear|scattered|overcast|storm, `fog` 0..1 (a low, thick
  layer), `haze` 0..1 (aerial perspective), `grade` neutral|warm|cold|sepia|bleach, optional `moon: {az, el}`, `exposure`.
- `weather`: `rain`, `snow`, `dust`, `ash`, `embers` 0..1, `wind` 0..1 (0..12 m/s), optional `windDir`. The particles are
  anchored in the world and wrapped around the camera, and each one is a pure function of t. Ash falls as tumbling
  grey flakes; optional `ash_cover` 0..1 greys every up-facing surface (default: only heavy ash, 0.8 x smoothstep of
  (ash - 0.6) / 0.4). Coast worlds lay a beach (pale sand, wet swash band, surf lines) with marram on the dunes behind it.
- `world`, `cast`, `groups`, `objects`, `structures`, `labels`: resolved by the registry (below).
  Labels (lib/human/labels.js): the monumental styles stone|bronze|gold|clay|neon|ice and the story styles `almanac`
  (off-white EB Garamond caps + a mustard #D9A93F rule: place/date stamps) and `almanac_sans` (off-white Inter SemiBold:
  numbers). Story keys on any style: `t_in`, `t_out`, `reveal` type|fade|rise|scale|ground, `at` + `elev` | `on` <ref>
  (+ `offset` [dx, dy, dz]) to follow an item, `face_camera`, `align`, `rule`, `rule_len`, `unit`, `caps`, `screen` (cap
  height as a fraction of the frame at the reveal). Text runs on scene time, not the world clock.
- `camera`: `move` fpv_flythrough|reveal_rise|orbit|push_in|crane_down|flyover_high|follow|pull_back|through
  (map_dive becomes crane_down until v1.1), `target` stage|ref:<castId>|groups:N|objects:N|structures:N|labels:N|[x,z],
  `side` left|right|front|back (relative to the target's heading), `speed` slow|medium|fast, `altitude` [start, end],
  `passes` [targets], `end` rise|continue|settle, `fov`, `dof` auto|off|0..3.
  `pov` (first-person run for hooks, additive): `target` = the threat, `side` = where the run starts, optional `path`
  [[x, z]..], `speed` m/s | slow|medium|fast, `eye` 1.62, `start_dist`, `glances` [t..] (look back at the target),
  `stumbles` [t..], `breath` Hz, `bob` m; checked against qa.js POV_LIMITS (eye >= 1.3 m, sprint speed, eased head
  turns <= 185 deg/s, roll <= 8 deg, never inside a solid). FX kinds `fx.*` live in lib/fx (index.js).
  `keys` (composed shots): `keys` [{t, pos: [x,y,z] | at: [x,z] + alt, look: [x,y,z] | look_at: [x,z] + look_h, fov}],
  `track`, `lambda`, `limits` eye (1.3 m clearance) | macro (0.15 m, figures 0.6 m: a lens on the ground).
  Cinematography (core/camera.js, any move; the cookbook is `disasters/edit/notes_Q6.md`):
  - `fov` on keys / `lens` [{t, fov}]: a lens track in time (monotone cubic, eased at the ends, held outside).
  - `dolly_zoom` {t: [t0, t1], fov, target, ease}: the vertigo shot; the camera travels along its axis so the target keeps
    its size on screen while the lens goes from the shot's fov at t0 to `fov` (held after t1; ratio clamped to 0.2–5).
  - `focus` [{t, target, fstop, pull}]: rack focus. Targets use real positions (cast feet anchor, a crowd's visible
    members, vehicle/boat body, fx fronts, `objects:N.<anchor>`, [x, y, z], `infinity`); the focus plane moves in dioptres
    (smootherstep, `pull` s before t); `fstop` is a full-frame f-number at the current lens. The defocused subject is held
    at ≤ 7 px blur radius (1080p) and the far background ≤ 10 px; scenes with focus keys render 12 sub-frames (4 draft).
  - `shake` [{t, amp deg, dur s, freq Hz, attack s, roll 0..1}]: a designed impact shake (smooth incommensurate sines under
    an eased attack / decay), clamped to 2.5 deg and 2.5 s, at most 3 per scene.
  - `handheld` 0..1: a slow operator drift (< 0.6 Hz: ±0.45° yaw, ±0.43° pitch, ±0.3° roll, ±2 cm at 1).
  - `strict`: the path is final: no lift bumps, no relax levels, no flyover fallback; a failing path is reported (ok false).
- `clock` (world time, main.js): `offset`, `rate`, `freeze_at`, `ease`, `keys` [{t, rate}] (speed ramps: the rate eases
  between keys and the world time is its exact integral), `sync` {t, w} (the world shows its time w at scene time t).
  The camera, the text and the shakes stay on scene time; the report's `clock` gives the world time at the key times.
- `transition`: `in`/`out`. The engine renders `warp` (0.3 s radial zoom streak, warm flash and chromatic split, as in
  assemble_intro.py) and `whiteout` (0.4 s cloud fill). The compositor handles `cut` and `dissolve`.
- `render`: `sub` (sub-frames, default 6 final / 2 draft), `shutter` (default 0.5).
Unknown keys produce warnings and are ignored. An unknown kind falls back to the nearest catalog kind (warned).

## Page contract (`index.html?w=1920&h=1080[&sub=N&quality=draft]`)
- `window.__ready` / `window.__error`
- `await window.loadScene(spec, {cast, quality})` → `{dur, warnings, camera: {move, level, changes, ok, issues}, ...}`
- `window.renderFrame(t)`: sub-frames (motion blur + DOF aperture samples re-aimed at the focus), bloom, grade, vignette,
  grain seeded by the frame number, then the transitions.
- `window.qaFrame(t)` → `{clearance_m, cam_speed, ang_speed, roll_deg, speed_limit, inside, fig_dist, warnings, transition: {warp, white}, designed?: {shake, dolly}}`
- `window.worldTime(t)`: the world time (spec.clock) at scene time t.
- `window.qaScene(fps)` (all frames, aggregated), `window.replan(level)`, `window.grabFrame(q)` (JPEG + luma stats),
  `window.setCast(list)`, `window.getCatalog()`.

## Camera safety
Every move is keyframed on `glide()` (core/wcam.js) and then checked at 15 Hz: terrain/water clearance ≥ 2 m (6 m when
fast), ≥ 1.2 m from any figure, never inside a solid (leaf-mesh and per-instance boxes, with a 0.6 m margin), speed ≤
0.8 × altitude/s below 80 m, angular speed ≤ 45°/s, roll ≤ 8° (banking only on drone moves, capped at 7°), and moving
at both ends. Local problems get smooth lift or side-step bumps (Gaussians in t, so the path stays C1). A move that
bumps cannot fix is re-planned higher, slower and wider (relax levels 1–4). The last resort is a high flyover
(`camera.strict` switches bumps, relax and fallback off and reports the failure instead). Designed layers (dolly zoom,
shake, handheld) ride on the base path: speed, turn and roll are measured on the base path, the final path is checked
for clearance, solids and figures, and a designed layer that breaks those fails QA (never lifted). Depth of field: a
crowd subject focuses on its visible members; the aperture is capped so the nearest solid in frame (probe boxes plus
opaque static noQA meshes such as fx trees) blurs at most 4.5 px (7 px with a rack focus), never a multi-copy ghost. Every
change is reported. `render.py` runs `qaScene` again before rendering, re-plans twice if needed, and does not render a
scene that still fails unless `--force` is given. It then checks the rendered frames for black, blown-out and
single-frame-jump frames (transition frames excepted) and renders any flagged frame again.

## Locomotion QA (QUALITY.md H1, core/loco.js)
`qaScene` also returns `locomotion: {ok, checked, walkers, max_angle_deg, backwards, sideways, slide_ratio_min,
slide_ratio_max, flip_step_max_m, flagged: [...], items: [...]}` (once per scene, independent of the camera) and adds
its flags to `issues`; `ok` stays the camera gate, so a locomotion flag never blocks a render. For every moving figure,
group instance and creature, sampled every 0.1 s: the angle between facing and travel (> 35° sideways, > 90° backwards,
while faster than 0.3 m/s) and gait vs ground on the planted foot (within 2 cm of the ground): a walker slides when its
median is outside 0.8–1.25 or more than 20 % of its contacts are. `render.py` logs a `locomotion ok|FLAGGED` line.

## Adding a module (lib/nature, lib/human)
`lib/<lib>/index.js` exports `MODULES = [module, ...]` (module objects, or paths relative to the index). Each module
exports `CATALOG = { 'kind.name': { desc, actions, params, footprint, height, tags, section? } }` and
`async build(kind, item, ctx) -> { root (placed), radius, height, update(t, clock, camera), anchors, members?(t), contacts? }`.
World modules also export `buildWorld(world, look, ctx) -> { ground: {height(x, z), normal(x, z)}, water?: {level}, update }`.
- `item` is the spec entry plus `at: [x, z]`, `pos: [x, y, z]` (ground-snapped), `heading` (compass degrees; labels face
  it), `index`, `seed`, `params`. Cast entries get `ref` and `def` (the CastDef; `witness` is built in).
- `ctx`: `THREE, scene` (the scene's stage group), `ground, water, rng(seed), patch(material)` (shared height fog),
  `text3d, cast, lod, quality, tex, cache` (kept for the whole job), `wind {x, z, speed}, U` (shared uniforms),
  `contacts.add({x, z, w, l, rot, a, follow | fn})`, `warn(msg)` and `warnings`.
- The registry snaps roots to the ground and keeps moving roots snapped. A builder that places things itself returns
  `snapped: true`. Kinds with `snap: false` or `fly: true` are never snapped.
- Contact shadows: the registry adds a terrain-following decal under every standing thing, unless the builder made its own
  (through `ctx.contacts`, or meshes named `contactShadow`). Groups should return `members(t) -> [[x, z], ...]`. The
  registry uses it for per-figure shadows and for the camera's figure-distance check.
- Openings the `through` move can fly through: `anchors.opening = {pos, normal, w, h}`.
- Things that walk opt into the locomotion QA with `loco: { walkers(t) -> [{x, z, yaw, feet?, phase?, stride?}] }` (yaw =
  rotation.y of a +Z model; feet = world contact points per foot, or phase in cycles + stride in m per cycle; see
  core/loco.js). A group whose root stays at the origin returns `anchors.body` at its real centre (camera subject, DOF).
- Rules: deterministic in t, instancing for repeats, every animated state eases, a build finishes in under 20 s.
- If an index fails because a module is missing, the registry still loads every module the index names that works
  (status "partial").
