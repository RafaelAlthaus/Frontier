# Frontier 3D — director's cookbook (v2, exact syntax)

Everything here renders on this engine. Anything not here or in the CATALOG does not exist — never invent a kind, an
action or a key. Unknown keys are ignored with a warning; an unknown kind becomes the nearest catalog kind (usually
wrong). `scale` and `beat` are your notes on a shot (the validator reads them; the engine never sees them).

## 0. The grammar in numbers (the validator measures these)
| rule | number |
|---|---|
| shot length | 2–5 s; action and the cold open [MIN SHOT]–3 s; the engine's shortest shot is [MIN SHOT] s |
| emotional hold | one shot of 6–8 s per minute of 3D; 8 s is the hard maximum |
| shots per moment | >= ceil(N / 4) for a moment of N s |
| cold open | 3–4 shots in the first 8–10 s; the first shot <= 3 s with the hero big within 1 s |
| neighbours | never the same move (for keys: the same kind of motion) or the same scale twice in a row |
| a keys shot moves | size >= 15 %, or arc around the subject >= 8°, or view direction >= 8° (x dur/4 over 4 s) |
| still frame | only as a sting of <= 2.5 s |
| text | at most one label per ~10 s, never in the bottom quarter |
| hero size | ship >= 30 % of the frame width in its hero shot; person >= 15 % of the frame height |

## 1. Geography — where things are
- Metres on the ground. **x = east, z = south** (so north is −z). The stage (the scene's focal point) is [0, 0].
- **heading** is a compass bearing: 0 = north (−z), 90 = east (+x), 180 = south (+z), 270 = west (−x). A thing at
  heading h moves along (sin h, −cos h). Labels and figures face their heading.
- Ground height is automatic: everything is snapped to the terrain (ships to the water). `alt` on the camera = metres
  above the ground or water under it.
- **Coast worlds** (`"biome": "coast"`): `"world": {"biome": "coast", "coast": {"sea": "east", "shore": 60, "cliffs": "none"},
  "season": "summer"}` → the sea is everything east of x ≈ 60 (the shoreline wanders ±25 m), the pale sand beach is the
  band x ≈ 35..60, dunes and grass behind it (west). To SEE the beach: camera on or just above the beach (x 30..75,
  alt 1.6..12) looking along the shore (heading 0/180) or out to sea (heading 90). Palms (`flora.palm`) along x 20..40.
  `season: "winter"` kills the grass — use summer for anything tropical or sunny.
- **Open sea** (`"biome": "ocean"`): water to every horizon, no land. Ships sit on the water; the camera needs alt ≥ 2.
  A ship at [0, 0] with heading 90 sails east.
- **Towns**: `town.*` structures are laid out around their `at` (a few hundred m): the camera flies over them (alt ≥ 30)
  or stands in a street (eye level, keys + `limits: "eye"`). Crowds go on the square at the town's `at` or on a road.
- **Interiors are closed sets.** An `interior.*` scene uses a LAND world — `"world": {"biome": "plains", "relief": 0,
  "vegetation": 0}` — never ocean/coast (the sea shows through the floor: "water in the room"). The camera stays INSIDE
  (keys, eye level, `limits: "eye"`); a camera outside sees the back of the walls. Room sizes (x by z, height):
  study 5 × 6.5 × 3.2, office 5 × 7 × 3.0, cellar 4 × 6 × 2.7, storm_cellar 3 × 5.6 × 2.3, small_room 2.2 × 5.4 × 2.5,
  cell 3.7 × 4.2 × 2.6, palace_hall 14 × 34 × 11 — keep the camera 0.4 m inside the walls.
- **The study and the office at `"at": [0, 0], "heading": 0`** (use exactly this; other headings rotate everything):
  desk centre [0.3, −0.6] (1.6 m wide in x, 0.8 m deep in z, top at 0.76 m) with the lamp on its north-east corner
  [0.85, −0.8]; the desk chair at [0.3, 0.1] facing north toward the desk. **A seated person at the desk:
  `"at": [0.3, 0.15], "heading": 0, "action": "sit", "seat": "none"`** (the study's own chair; `sit` without
  `seat` brings its own chair, which would stand inside the room's chair; never at the desk centre). A standing person: free floor
  south of the chair, e.g. [0.3, 1.3] or [−1.0, 0.4], facing the desk (heading 0). The window is in the east wall
  (x = +2.5), bookshelves on the west wall (x = −2.3), the study's fireplace at [0, 3.0] on the south wall and its
  leather armchair at [−1.1, 1.4]. **The camera's free space** (the engine keeps 0.6 m from every wall and tall
  shelf and LIFTS a camera that comes closer — straight through the ceiling): study x −1.4..1.8, z −2.6..2.6; office
  x −1.4..1.8, z −2.9..2.9; alt 1.2..2.4. Give every interior camera `"strict": true` so a bad key is reported to the
  review instead of lifted. **The study's fireplace** (south wall, [0, 3.0]) glows as a big orange box: never look
  south toward it (z > 0.5 behind the subject) unless the camera looks down at the desk. Tested spots (study/office at
  heading 0): the room wide [−1.3, 2.4] alt 1.8 looking at [0.3, −0.4] (look_h 1.0, looking north, the fireplace
  behind the camera); **his profile from the east** [1.6, 0.4] alt 1.35 looking at [0.3, 0.15] (look_h 1.15, the
  bookshelves behind him, the lamp lighting his face); his profile from the west [−1.3, 0.3] alt 1.3 looking at
  [0.3, 0.15] (look_h 1.15, the dark window behind him, the lamp as a rim light); the papers [−0.6, −1.5] alt 1.6
  looking at [0.2, −0.6] (look_h 0.78); over his shoulder [1.3, 1.2] alt 1.6 looking at [0.3, −0.6] (look_h 0.8). Never a move template (push_in, orbit, crane...)
  inside a room: they start metres away, outside the walls. The desk lamp burns a face that comes within 1 m of it:
  frame the face away from [0.85, −0.8] or keep the camera on the lamp's far side.
- `world.features`: `{"type": "road", "from": [x, z], "to": [x, z], "width": 7}`, `river` (from/to or points, width),
  `lake` (at, radius), `ridge`, `valley`, `cliff` (at, height, length, heading = where the face looks),
  `forest_edge` (side north|south|east|west, dist). Vehicles that drive need a road under their path.
- `world.grass_radius` (default 80 m around the origin): raise to 120–200 when eye-level cameras stand > 45 m out.

## 2. Look, light, sky, weather
- `"look": {"time": "dawn|morning|noon|afternoon|golden|dusk|night|overcast", "sky": "clear|scattered|overcast|storm|smoke|storm_green",
  "fog": 0..1, "haze": 0..1, "grade": "neutral|warm|cold|sepia|bleach", "sun": {"az": deg, "el": deg}, "exposure": 1.0}`
- `sky: "storm"` = a low dark deck with scud; `"smoke"` = the day the sky turned orange; `"storm_green"` = hail sky.
  `haze` 0.3–0.45 gives blue aerial perspective on clear days; above 0.7 it greys everything out.
- **Night**: `time: "night"`, `sky: "clear"` (scattered/overcast clouds catch light and read as bright white blobs at
  night — avoid), `{"kind": "space.starfield"}` in objects, practical lights (the liner's portholes light
  automatically, cars `"lights": true`, interior lamps, fires, a `lantern` accessory) and `exposure` 1.15–1.3 so the
  frame reads. A night frame must always have something lit in it. **At night prefer `wide` over `extreme_wide`**:
  an extreme wide reads only as a lit silhouette on the horizon line (camera low, 2–15 m, the hero >= 20 % of the
  frame width); a high night wide is a speck in a blue void.
- `"weather": {"rain": 0..1, "snow": 0..1, "dust": 0..1, "ash": 0..1, "embers": 0..1, "wind": 0..1}`;
  `"ash_kind": "volcanic"` for real volcanic ash (else ash reads as snow); `ash_cover` 0..1 greys the ground.

## 3. People
- **CastDef** (the video's recurring people, top level `cast`): `{"id": "smith", "name": "Captain Edward Smith", "role": "...",
  "kit": "<kit>", "colors": {"coat": "#hex", "trousers": "#hex", "accent": "#hex"}, "headwear": "<headwear>",
  "accessories": ["..."], "build": {"height": 1.8, "bulk": 1.0}, "signature": "sash|armband|medals|epaulettes|scarf"}`
  (`signature` = one or two of those five named details, space-separated — nothing else).
  Kits: witness ancient_robe roman_legion medieval_knight medieval_peasant renaissance 1800s_formal napoleonic_british
  napoleonic_french civil_war 1910s_formal ww1_soldier ww2_us ww2_german ww2_british 1950s_casual modern_business
  modern_casual scientist astronaut worker royalty farm_1800s forager (aliases: edwardian → 1910s_formal, victorian,
  sailor/officer → pick the nearest uniform-like kit and colour it).
  Headwear: none m1 stahlhelm field_cap peaked_cap brodie shako bicorne top_hat bowler fedora kepi flat_cap baseball
  beret hood coif nasal kettle galea crown laurel hard_hat space_helmet. Accessories: scarf cape flag backpack lantern
  briefcase lifepack shield sword rifle carbine musket. Height under ~1.6 m gets child proportions. Everyone is a
  faceless mannequin.
- **In a scene**: `"cast": [{"ref": "smith", "at": [x, z], "heading": deg, "action": "<action>", "path": [[x, z], ...],
  "speed": m/s, "face": [x, z]}]`. Actions: stand idle watch attention walk run sprint march salute point sit
  sit_ground kneel take_cover wave speak cheer aim ride, plus lie_back, struck_fall, look_up, shield_face, cpr, dig,
  probe, beacon, ski, enter, blanket_crouch, tap_helmet.
  - `"action": "point", "point_at": [x, z]` points at a place. `"action": "watch", "look_at": [x, y, z]`.
  - Timeline: `"actions": [{"t": 0, "action": "watch"}, {"t": 4.2, "action": "look_up"}]` (each change eases).
  - **Posture is fixed per shot**: a seated figure (`sit`, `sit_ground`) stays seated for the whole shot. Upper-body
    actions on a seated figure (look_up, speak, point, watch, wave) play seated only on the newest engine; any
    `stand`/`attention`/moving action stands the body up where it sits, inside the desk or chair. To show a seated
    man rise, cut to a new shot where he stands. `sit` brings its own chair unless `"seat": "bench"|"none"` (the
    scene has the 0.46 m seat: a room's chair, a bench, a lifeboat thwart). Nobody stands inside furniture, walls or
    another person: >= 0.6 m between people, >= 0.4 m from walls.
  - Walkers face where they go; path corners are walked as arcs; `"start": s` delays and eases the start.
- **Crowds** (`groups`): `{"kind": "figure.<kit>" | "figure.crowd", "count": n, "formation": "column|line|square|crowd|scatter",
  "at": [x, z], "size": [w, d], "heading": deg, "action": "idle|stand|watch|walk|run|march|charge|cheer|kneel|aim",
  "speed": m/s, "path": [[x, z], ...], "params": {"era": "ancient|medieval|1800s|1910s|1950s|modern"}, "wander": true,
  "face": [x, z]}`. Moving figures always face their travel. Keep crowds ≥ 3 m from the camera path.
- Scale: people are 1.7–1.8 m. A person is >= 15 % of the frame height in a character shot: at fov 30 that is a
  camera <= 6.5 m away; at fov 24, <= 8 m.

## 4. Things and places (see the CATALOG for every kind)
- Ships: `{"kind": "ship.liner_1912", "at": [0, 0], "heading": 90, "action": "sail", "speed": 11}` (Titanic-class,
  269 m x 28 m, portholes lit at night). **Its `at` is MIDSHIP**: along the heading the bow (stem) is 134.5 m ahead
  and the stern 134.5 m behind. At [0, 0] heading 90 (sailing east, while it is still at t = 0): bow x +134, bridge
  x +75 (boat deck ~18 m up), foremast + crow's nest x +94 (nest 29 m up), funnels x +52, +26, 0, −26 (tops 43 m),
  mainmast x −78, stern x −134; the hull sides are at z ±14. It moves `speed` m/s along its heading, so at t it is
  `speed x t` further on — aim the camera where she WILL be. A ship reads as a hero at 250–600 m with fov 24–32.
  `ship.rowboat` (`"crew": 2`, `"keys": [{"t", "at", "y", "pitch", "roll", "heading"}]` scripted ride), `ship.warship`,
  `ship.sailing_ancient`, `ship.troller`, `ship.longtail` (`"beached": true` rests a small boat on sand). A moving ship
  leaves a wake; `water.wake` / `water.splash` (t, size).
<!--needs:!nature.iceberg-->
- **Ship paths turn gradually**: a straight `heading` + `speed` for most shots (a liner turns a few degrees in a whole
  shot). If it must turn, give a `path` with many points on a wide arc: <= 10° heading change per point and points
  >= 40 m apart for a liner (a 20° turn = 3 points 60 m apart). A corner snaps the hull around like a glitch.
<!--/needs-->
<!--needs:nature.iceberg-->
- **Ship paths turn gradually** by themselves (section 9: the engine fillets every corner with the turning radius; a
  liner turns ~1°/s). Most shots: a straight `heading` + `speed`.
<!--/needs-->
- Vehicles: `vehicle.car_1920|car_1960|car_modern|car_suv|jeep|truck_ww2|tank_ww2` with `"action": "drive", "speed", "path"`
  on a road feature (path corners <= 25°); `aircraft.airliner|biplane|bomber_ww2|fighter_ww2` with `"action": "fly",
  "alt": m, "path"`. Cars: `"lights": true`, `"color"`, `"livery": "police"`.
- Buildings: `landmark.house` (`"style": "farmhouse|suburban"`, `"door": [[t, deg]]`, `"lit": [[t, 0..1]]`), `landmark.castle`,
  `church`, `tower`, `bridge`, `fortress_wall`, `pyramid`, `lighthouse`, `statue`, `cave`, `boat_sheds`. Towns:
  `town.medieval_town|village_europe_1940|american_small_town|modern_city|ancient_mediterranean|middle_east_town|farm|front_street`.
- Rooms: `interior.study|office|palace_hall|cellar|cell|storm_cellar|small_room` (`"style": "bathroom|closet|hallway"`).
- Props: `prop.sign`, `prop.fence`, `prop.power_poles`, `prop.siren_pole`, `prop.tv`.
- Nature: `flora.*`, `rock.boulder|rock`, `creature.*` (horse, deer, wolf, whale, bird_flock, fish_shoal, dinosaurs),
  `space.earth|moon|mars|sun|starfield`.
- Map-like beats: `marker.route` (a glowing line that draws itself along `path`), `marker.arrow`, `marker.pin`.

## 5. Text in the world (labels) — sometimes
- A kinetic stamp at a story beat: `{"text": "11:40 PM", "sub": "14 April 1912", "style": "almanac_sans", "at": [x, z],
  "elev": 40, "screen": 0.05, "t_in": 0.3, "t_out": 2.2, "reveal": "type"}` or a place/date `almanac` stamp
  (`"style": "almanac"`, `screen` 0.03). `on: "ref:<id>" | "objects:N"` + `offset` [dx, dy, dz] follows a person or a
  ship (a ship's label: `"offset": [0, 60, 0]` puts it in the sky above her).
- Put text in the upper-middle of the frame and keep it there for its WHOLE life: the whole block 15–70 % from the
  top and clear of the sides while the camera moves (a stamp placed near the top drifts out as the camera pushes or
  tilts). Sky above the subject, a mast, a wall — never the bottom quarter (captions). High stamps reveal with
  "type" or "fade"; "rise" only in the middle band. Over water a low label reflects into the sea (the caption zone): keep
  it high. The engine lifts a label that something hides, but plan it clear. At most one label per ~10 s, out (`t_out`) before the cut and before
  anything passes in front of it. Never retype the narration; never duplicate a 2D graphic or map.
- Monumental 3D lettering (`stone|bronze|gold|clay|neon|ice`, `"height": m`) only for a title moment in an epic cold
  open — at most once a video.

## 6. Camera — energy with smooth moves
- Moves: `fpv_flythrough reveal_rise orbit push_in crane_down flyover_high follow pull_back through pov keys`.
  `"camera": {"move": "...", "target": "stage|ref:<id>|groups:N|objects:N|structures:N|labels:N|[x, z]", "side": "left|right|front|back",
  "speed": "slow|medium|fast", "altitude": [start_m, end_m], "passes": ["groups:0"], "end": "rise|continue|settle", "fov": 40}`.
- What each move gives you (pick by intent, then vary):
  | move | intent | good values |
  |---|---|---|
  | `follow` | travel with a moving hero (ship, car, column) | `side`, `altitude` [20, 14] for a liner, fov 28–35 |
<!--needs:!src:core/camera.js:function T_dart(-->
  | `fpv_flythrough` | FPV energy: dive in, weave past things | >= 3.5 s, `speed: "fast"`, `altitude` [14, 5], `end: "continue"`; see below |
<!--/needs-->
<!--needs:src:core/camera.js:function T_dart(-->
  | `fpv_flythrough` | FPV energy at ANY length: under 3.6 s it is an FPV dart (one straight fast pass past the subject, along a ship's side head-on, passing her at 55 % of the shot); 3.6 s and longer it weaves in past things | darts: `altitude` [6, 10] low past a hull, `side`; long: `speed: "fast"`, `altitude` [14, 5], `passes` |
<!--/needs-->
  | `crane_down` | arrive from the sky ("from the stars down") | `altitude` [220, 25] onto a ship, [30, 2.2] onto people |
<!--needs:!src:core/camera.js:function longSubject(-->
  | `flyover_high` | geography over LAND (a town, a front, a coast) | alt set by the scene; fov 35–45 — over a ship it swings her heading across the frame (reads as the glitch Robin hates): not for ships |
<!--/needs-->
<!--needs:src:core/camera.js:function longSubject(-->
  | `flyover_high` | geography, scale, the whole event | fov 35–45; beside a ship it arcs along her instead of spinning her |
<!--/needs-->
  | `reveal_rise` | rise over something to reveal the hero | needs a foreground object (`passes` or an occluder) |
<!--needs:!src:core/camera.js:function longSubject(-->
  | `orbit` | the hero as a monument; tension | ~180° whatever the length (2–3 s = a fast spin): LOW, horizon in frame; never high over a ship (she spins in frame) — for ships prefer a keys arc of 15–30° |
<!--/needs-->
<!--needs:src:core/camera.js:function longSubject(-->
  | `orbit` | the hero as a monument; tension | people/objects: a fast ~180° arc; a SHIP: a drone arc beside her (<= 9°/s), low with the horizon in frame |
<!--/needs-->
  | `push_in` | realization, focus on a person or a detail | fov 28–35 people, 20–28 ship details |
  | `pull_back` | isolation, the end of a beat | `altitude` [2, 30] |
  | `through` | an impossible pass through an opening | a target with an opening (arch, door, window, letters) |
  | `keys` | a designed shot: interiors, eye level, low over water | 2–4 keys with a CLEAR push or arc |
<!--needs:!src:core/camera.js:function T_dart(-->
- **What fails today** (the engine replaces the move with a 110 m high flyover and the shot is lost):
  - `fpv_flythrough` under ~3.5 s with `end: "settle"` (the view swings onto the subject faster than 45°/s), with
    `passes` more than ~60 m off its line (it climbs x30 to reach them), or around a big ship (it keeps s.r + 3 m =
    140 m off a liner and looks along its own path, not at her). For FPV energy on a ship use `keys`: 3–4 keys low
    over the water (alt 4–8) running along the hull at a legal speed (<= 0.8 x alt per second), looking at points
    ON the hull that slide along with you, or `follow` low (`altitude` [8, 6]) — speed comes from the hull filling
    the frame, not from a number.
  - Any template inside a room (see the interiors).
<!--/needs-->
<!--needs:src:core/camera.js:function T_dart(-->
- **Drone and FPV are the exterior default** (Robin asked for them): an FPV move is never lost any more — whatever
  cannot be flown legally becomes an FPV dart past the subject. Still: no move templates inside a room (interiors).
<!--/needs-->
- **At sea the horizon is the drama.** Keep the camera LOW for its distance (alt <= 1/4 of the distance to the
  subject: 400 m off a liner at 5–60 m, a lifeboat 25 m away at 2.5–5 m) so the horizon, the stars and the lit ship
  share the frame. A steep look down on water is an empty blue texture — templates look down when `altitude` is high
  for a small subject (push_in / pull_back / crane_down on a rowboat from 20 m) — at most one top-down geography
  shot per minute.
- **Composed shot** (`keys`): `{"move": "keys", "target": "ref:you", "limits": "eye", "keys": [{"t": 0, "at": [x, z],
  "alt": 1.6, "look_at": [x, z], "look_h": 1.4, "fov": 34}, {"t": 3, "at": [x, z], "alt": 1.5, "look_at": [x, z],
  "look_h": 1.4, "fov": 30}]}` (or `pos` [x, y, z] / `look` [x, y, z]; omit `look_at` to look at the target). It must
  MOVE: from 6 m to 4 m on a person (+50 % size), or an arc of 20–40° around them, or a pan that reveals something.
  Two keys 2 m apart on a subject 500 m away are a static postcard (rejected).
- Speed: `slow|medium|fast` = 0.4 / 0.55 / 0.7 × altitude per second. Safety (automatic): ≥ 2 m above terrain/water
  (6 m when fast), ≥ 1.2 m from figures, never inside solids, speed ≤ 0.8 × altitude per second below 80 m, turns
  ≤ 45°/s. **A path that breaks a rule is LIFTED** (the shot silently turns into a steep look down) or re-planned;
  with `"strict": true` it is reported instead. Plan legal speeds in `keys`:
  | camera altitude | max camera speed | travel in a 2.5 s shot |
  |---|---|---|
  | 2 m | 1.6 m/s | 4 m |
  | 5 m | 4 m/s | 10 m |
  | 10 m | 8 m/s | 20 m |
  | 14 m | 11 m/s (a liner's speed) | 28 m |
  | 30 m | 24 m/s | 60 m |
  | 80 m and up | no limit | — |
  A camera that keeps pace with a liner at 11 m/s must be >= 14 m up; lower, let her sail PAST a slower camera (the
  hull sweeping through the frame is the speed). Speed comes from being LOW and CLOSE to things (parallax).
- Tools (one or two per shot):
  - lens track `"lens": [{"t": 0, "fov": 40}, {"t": 3, "fov": 30}]` — a push by the lens where the camera can't move.
  - dolly zoom `"dolly_zoom": {"t": [t0, t1], "fov": 24, "target": "ref:you"}` — once per film, the realization beat.
  - rack focus `"focus": [{"t": 0, "target": "ref:you", "fstop": 1.4}, {"t": 1.6, "target": "objects:0", "fstop": 1.4, "pull": 0.8}]`
    — a reveal; needs a long lens (fov 20–30) and subjects far apart in depth.
  - shake `"shake": [{"t": 1.2, "amp": 0.9, "dur": 0.7, "freq": 9}]` — ONLY on an impact, 0.4–1 s.
  - handheld `"handheld": 0.4` — eye-level documentary shots of people.
- **Speed ramps** (the world slows; camera, text and narration stay on time): top level
  `"clock": {"keys": [{"t": 0, "rate": 1}, {"t": 1.0, "rate": 0.25}, {"t": 2.2, "rate": 0.25}, {"t": 2.8, "rate": 1}]}`.
- **Continuity across cuts**: `"clock": {"offset": 6.5}` starts the world 6.5 s later (the ship has sailed on, the
  boat has rowed further) — use it on the 2nd/3rd shot of the same event so the action continues instead of resetting.
- Transitions `"transition": {"in": "cut|warp|whiteout", "out": "..."}`: cut by default; `warp` is a fast whip (0.15 s
  either side of the cut) — only for a real jump in time or place, on both sides of that cut (`out` of the first shot,
  `in` of the next); whiteout only into cloud/smoke/fog. Never end a shot on a white or black frame.

## 7. Disaster and event FX (fx.*; times are world seconds)
- `fx.tsunami` modes coast|knee|drawback, `fx.megatsunami`, `fx.tornado` (`"shape": "rope|cone|wedge"`),
  `fx.lightning` (`"mode": "strike|storm|through_figure"`), `fx.wildfire` (`"fuel": "grass|forest"`), `fx.hurricane`
  (`"mode": "wind|storm_surge"`), `fx.quake`, `fx.eruption`, `fx.pyroclastic`, `fx.avalanche`, `fx.impact`, `fx.grb`.
  Example: `{"kind": "fx.tsunami", "mode": "drawback", "at": [50, 30], "heading": 270, "params": {"t0": 0, "dur": 2.5,
  "to": -7, "fish": 70, "boat": true}}`. Use an FX only when the narration is about that event.

## 8. Sequence templates (exact JSON; adapt positions, kinds and words — never copy the same one twice in a film)
Shared blocks used below: `NIGHT` = `"look": {"time": "night", "sky": "clear", "grade": "cold", "exposure": 1.25}`,
`SEA` = `"world": {"biome": "ocean"}`, `LINER` = `{"kind": "ship.liner_1912", "at": [0, 0], "heading": 90, "action":
"sail", "speed": 11}`, `STARS` = `{"kind": "space.starfield"}`. Write them out in full in your specs.

**A. Opening hook — 9 s, 4 shots, hero first, climbing in.**
```
{"id": "m0_hero", "dur": 2.4, "scale": "wide", "beat": "the lit liner at speed, big from frame one", NIGHT, SEA,
 "objects": [LINER, STARS], "camera": {"move": "follow", "target": "objects:0", "side": "left", "altitude": [26, 18], "fov": 30}},
{"id": "m0_skim", "dur": 2.2, "scale": "extreme_wide", "beat": "FPV skimming the black sea toward her lit side", NIGHT, SEA,
 "objects": [LINER, STARS], "clock": {"offset": 2.4},
 "camera": {"move": "fpv_flythrough", "target": "objects:0", "side": "right", "speed": "fast", "altitude": [9, 4], "end": "continue", "fov": 50}},
{"id": "m0_stars", "dur": 2.2, "scale": "medium", "beat": "from the stars down onto her funnels", NIGHT, SEA,
 "objects": [LINER, STARS], "clock": {"offset": 4.6},
 "camera": {"move": "crane_down", "target": "objects:0", "altitude": [200, 45], "fov": 34},
 "labels": [{"text": "14 APRIL 1912", "sub": "North Atlantic", "style": "almanac", "on": "objects:0", "offset": [0, 70, 0], "screen": 0.035, "t_in": 0.3, "t_out": 2.0, "reveal": "type"}]},
{"id": "m0_bow", "dur": 2.2, "scale": "close", "beat": "low on the water ahead of her as the bow comes at us", NIGHT, SEA,
 "objects": [LINER, STARS],
 "camera": {"move": "keys", "target": "objects:0", "keys": [{"t": 0, "at": [235, -45], "alt": 6, "look_at": [134, 0], "look_h": 10, "fov": 30},
            {"t": 2.2, "at": [243, -32], "alt": 5, "look_at": [158, 0], "look_h": 10, "fov": 26}]}}
```
**B. Impact / collision — 7 s, 3 shots: approach fast, slow motion INTO the hit with one shake, reaction.**
```
{"id": "m4_approach", "dur": 2.3, "scale": "wide", "beat": "closing fast on the point of impact", ...,
 "camera": {"move": "fpv_flythrough", "target": "objects:0", "speed": "fast", "altitude": [12, 5], "end": "settle", "fov": 45}},
{"id": "m4_hit", "dur": 2.5, "scale": "insert", "beat": "the hit, in slow motion", ...,
 "clock": {"keys": [{"t": 0, "rate": 1}, {"t": 0.8, "rate": 0.25}, {"t": 2.5, "rate": 0.25}]},
 "camera": {"move": "push_in", "target": "objects:0", "fov": 26, "shake": [{"t": 1.1, "amp": 0.9, "dur": 0.7, "freq": 9}]}},
{"id": "m4_react", "dur": 2.2, "scale": "medium", "beat": "the people who felt it turn", ...,
 "camera": {"move": "keys", "target": "ref:<id>", "limits": "eye", "handheld": 0.5, "keys": [
   {"t": 0, "at": [3.5, 2.5], "alt": 1.6, "look_h": 1.5, "fov": 32}, {"t": 2.2, "at": [2.3, 1.2], "alt": 1.55, "look_h": 1.5, "fov": 30}]}}
```
**C. A character beat in a closed interior — 8 s, 3 shots (the study at [0, 0] heading 0, a seated man).**
```
{"id": "m2_room", "dur": 2.6, "scale": "wide", "beat": "the lamp-lit study, the man at his desk", "look": {"time": "night", "exposure": 1.1},
 "world": {"biome": "plains", "relief": 0, "vegetation": 0}, "structures": [{"kind": "interior.study", "at": [0, 0], "heading": 0}],
 "cast": [{"ref": "andrews", "at": [0.3, 0.15], "heading": 0, "action": "sit", "seat": "none"}],
 "camera": {"move": "keys", "target": "ref:andrews", "limits": "eye", "strict": true, "keys": [
   {"t": 0, "at": [-1.3, 2.4], "alt": 1.8, "look_at": [0.3, -0.4], "look_h": 1.0, "fov": 38},
   {"t": 2.6, "at": [-0.8, 1.8], "alt": 1.6, "look_at": [0.3, -0.4], "look_h": 1.0, "fov": 34}]}},
{"id": "m2_face", "dur": 2.8, "scale": "close", "beat": "his faceless head bowed over the plans, lamp-lit profile", ...same look/world/structures/cast...,
 "camera": {"move": "keys", "target": "ref:andrews", "limits": "eye", "strict": true, "handheld": 0.3, "keys": [
   {"t": 0, "at": [1.7, 0.5], "alt": 1.35, "look_at": [0.3, 0.15], "look_h": 1.15, "fov": 30},
   {"t": 2.8, "at": [1.35, 0.3], "alt": 1.3, "look_at": [0.3, 0.15], "look_h": 1.15, "fov": 26}]}},
{"id": "m2_papers", "dur": 2.6, "scale": "insert", "beat": "the drawings on the desk; the lamp", ...,
 "camera": {"move": "keys", "target": [0.3, -0.6], "limits": "eye", "keys": [
   {"t": 0, "at": [-0.6, -1.5], "alt": 1.6, "look_at": [0.2, -0.6], "look_h": 0.78, "fov": 30},
   {"t": 2.6, "at": [-0.4, -1.2], "alt": 1.35, "look_at": [0.2, -0.6], "look_h": 0.78, "fov": 30}]}}
```
**D. A journey — 12 s, 4 shots: map-like scale, then down to the traveller, then alongside.**
```
{"id": "m1_route", "dur": 3.0, "scale": "extreme_wide", "beat": "the route drawn across the sea", ...,
 "objects": [..., {"kind": "marker.route", "path": [[-900, 200], [-300, 60], [0, 0]], "t": [0.2, 2.6]}],
 "camera": {"move": "flyover_high", "target": "objects:0", "fov": 40}},
{"id": "m1_down", "dur": 3.0, "scale": "wide", "beat": "down to the ship leaving port", ..., "camera": {"move": "crane_down", "target": "objects:0", "altitude": [140, 30], "fov": 32}},
{"id": "m1_along", "dur": 3.0, "scale": "medium", "beat": "alongside her at speed", ..., "camera": {"move": "follow", "target": "objects:0", "side": "right", "altitude": [14, 10], "fov": 30}},
{"id": "m1_ahead", "dur": 3.0, "scale": "wide", "beat": "ahead of her bow, the horizon she sails into", ..., "camera": {"move": "pull_back", "target": [0, 0], "altitude": [6, 26], "fov": 36}}
```
**E. Aftermath or grief — 10 s, 3 shots: slow but moving, quiet, no text.**
```
{"id": "m6_boats", "dur": 3.5, "scale": "wide", "beat": "the lifeboats alone on the black water", NIGHT, SEA,
 "objects": [{"kind": "ship.rowboat", "at": [0, 0], "heading": 30, "crew": 2}, {"kind": "ship.rowboat", "at": [-40, 25], "heading": 350, "crew": 2},
             {"kind": "ship.rowboat", "at": [35, -30], "heading": 60, "crew": 2}, STARS],
 "camera": {"move": "keys", "target": "objects:0", "keys": [{"t": 0, "at": [-24, 30], "alt": 3.2, "fov": 34}, {"t": 3.5, "at": [-12, 34], "alt": 2.6, "fov": 30}]}},
{"id": "m6_hold", "dur": 3.5, "scale": "close", "beat": "one boat, the crew bowed", ..., "camera": {"move": "push_in", "target": "objects:0", "speed": "slow", "altitude": [3, 2.4], "fov": 28}},
{"id": "m6_alone", "dur": 3.0, "scale": "extreme_wide", "beat": "the empty sea, the boats specks", ..., "camera": {"move": "pull_back", "target": "objects:0", "altitude": [3, 40], "fov": 38}}
```
**F. Ending — 8 s, 3 shots: the image that answers the cold open, then out.**
```
{"id": "m9_dawn", "dur": 2.6, "scale": "wide", "beat": "dawn: the boats and the rescue ship", "look": {"time": "dawn", "sky": "scattered", "grade": "warm"}, ...,
 "camera": {"move": "follow", "target": "objects:0", "side": "left", "altitude": [5, 4], "fov": 32}},
{"id": "m9_face", "dur": 2.6, "scale": "close", "beat": "a survivor lifts her head to the light", ..., "camera": {"move": "push_in", "target": "ref:<id>", "fov": 30}},
{"id": "m9_out", "dur": 2.8, "scale": "extreme_wide", "beat": "rise away: the empty sea under the sun", ..., "camera": {"move": "pull_back", "target": "objects:0", "altitude": [4, 60], "fov": 40}}
```

## 8b. Inserts — show the specific thing
An insert is the named object, time or document, filled frame, 1.5–2.5 s, at the word: macro distance (0.3–0.8 m),
a long lens (fov 18–28), shallow focus, and ONE slow move — a push of 10–20 %, or a rack focus from the hand to the
object. It is the DETAIL rung of every moment's ladder. Frame its READABLE FACE big: the camera square to the dial,
the printed plan, the key (the prop's face looks along its `heading`: put the camera 0.3–0.8 m out along it, the face
filling half the frame or more) — not the chain of a watch, not half a plan. One idea per insert; a clock face must
not blow out (keep practical lights off it, `exposure` 1.0). The validator pulls an insert camera further than
1.4 m in to 0.8 m.
- Syntax that works on any small subject (a desk, a lamp, papers, a hand), inside a room: `keys` with
  `"limits": "eye"` and `"strict": true`, 2 keys 0.3–0.6 m apart, `"fov"` 26 -> 22, `"focus": [{"t": 0, "target":
  "ref:<id>", "fstop": 1.4}, {"t": 0.9, "target": "objects:0", "fstop": 1.4, "pull": 0.6}]`. On the ground or a
  table-top set outdoors: `"limits": "macro"` (a lens 0.15 m over the ground, 0.4 m/s at most).
<!--needs:detail.*-->
- **The detail kit** (`detail.*`: see each kind's line in the CATALOG for its exact params): a clock or pocket
  watch set to the named time (`time`, `run`), the engine telegraph (`setting`, `move_to`: the handle swings at the
  order), the wireless key (`text`, `tap`: the hand taps the call), the ship's bell (`ring`), papers (the ship plan
  with its flooded compartments, a letter, a telegram, a newspaper, a chart), tableware (`tilt`: sliding as she
  lists), a lifebuoy (`name`), a sign (`text`), a lantern. Put the detail at the stage [0, 0] of its own insert
  shot, and cut to it AT THE WORD that names it:
  `{"id": "m1_clock", "dur": 2.0, "scale": "insert", "pov": "ship", "beat": "the wheelhouse clock: 11:40",
    "look": {"time": "night", "exposure": 1.1}, "world": {"biome": "plains", "relief": 0, "vegetation": 0},
    "objects": [{"kind": "<a detail.* clock kind>", "at": [0, 0], "time": "23:40", "run": true}],
    "camera": {"move": "keys", "target": "objects:0", "limits": "macro", "strict": true, "keys": [
      {"t": 0, "at": [0, 0.9], "alt": 0.35, "look_at": [0, 0], "look_h": 0.2, "fov": 26},
      {"t": 2.0, "at": [0, 0.7], "alt": 0.33, "look_at": [0, 0], "look_h": 0.2, "fov": 22}]}}`
  (adapt the at/alt to the object's size from its catalog line; a wall clock hangs at its own height).
- Which words want an insert: a named time ("eleven forty", "ten past two") -> a clock; "he rings the bell" -> the
  bell; "the distress call" / "CQD" -> the wireless key; "five compartments" / "the plans" -> the plan; "full astern"
  -> the telegraph; a letter, a telegram, a newspaper, a chart -> the papers; "life belts" -> a lifebuoy.
<!--/needs-->

## 9. The sea-disaster kit and the new camera moves (only listed when this engine has them)
<!--needs:nature.iceberg-->
- **Liner anchors** (ride the ship and, once broken, its halves): give the liner `"id": "titanic"` and use
  `"titanic.<anchor>"` (or `"objects:N.<anchor>"`) as an `fpv_dive` `pass`, a `focus` / `dolly_zoom` target, a
  label's `on`, a flare's `from`, a lifeboat's `davit`
<!--needs:!src:core/camera.js:function anchorSubject(-->
  — NOT as `camera.target` (it only takes whole items: target `objects:N` and aim `keys` `look_at` at the anchor's
  place from the liner layout in section 4)
<!--/needs-->
<!--needs:src:core/camera.js:function anchorSubject(-->
  and as `camera.target` (the named point itself, riding the ship — with her trim, and with the right half once she
  breaks: push_in on `titanic.crows_nest`, orbit `titanic.stern`, dart past `titanic.bridge_wing`; `keys` with
  `"track": true` keep looking at it; once it goes under, the look holds where she went down)
<!--/needs-->
  :
  bow, forecastle, crows_nest, bridge, bridge_wing (port), bridge_wing_starboard, well_deck, boat_deck,
  boat_deck_starboard, stern_deck, stern, midship, funnel_1..funnel_4 (tops), boat_port_1..8, boat_starboard_1..8
  (davit heads, fore to aft). The camera now tracks a SAILING liner (`orbit` circles her where she is, `follow`
  follows her); her `at` is still midship.
<!--needs:param:ship.liner_1912:funnels-->
- **Other liners, honestly**: the same kind plays another liner through its params — `"funnels": 1..4`, `"length": m`,
  `"livery": "white_star" | "cunard"`, `"name"` on the bows. The Carpathia: `{"kind": "ship.liner_1912", "id":
  "carpathia", "funnels": 1, "length": 170, "livery": "cunard", "name": "CARPATHIA", "at": [x, z], "heading": deg,
  "action": "sail", "speed": 8}`; the Olympic: the default with `"name": "OLYMPIC"`. Its `id` names its anchors
  (`carpathia.bow`). Never the default four-funnel model under another ship's name.
<!--/needs-->
<!--needs:!param:ship.liner_1912:funnels-->
- **Other ships**: the liner model is the Titanic (four funnels). Another named liner (the Carpathia, the
  Californian) is only a line of lights on the horizon (the model 4–6 km away at night), its route, or a stamp.
<!--/needs-->
- **Smooth turns**: every ship/vehicle path is filleted with its turning radius (liner 430 m; `"turn_radius": m` to
  change it), the stern swings out and she heels a little — a path corner no longer snaps her round. Other keys on
  any moving vehicle: `"stop": true` (ease to rest at the path end), `"start": s` / `"from_rest": true`. A liner at
  11 m/s turns ~1°/s: a 10 s shot shows ~10° — film the turn from ahead or above her bow, long lens.
- **The iceberg**: `{"kind": "nature.iceberg", "at": [250, -30], "shape": "pinnacle", "size": 90, "seed": 7,
  "heading": 30}` — `shape` pinnacle (default: spires and jagged cliffs that LOOM over a low camera near a bow) | dome |
  tabular | drydock (two high walls, a low channel between); `size` 60–150 m long, `height` m above the water (pinnacle
  default 0.5 x size, max 60), `peaks` 1–4, `drift` m/s, `rim` 0–2 (the faint cold rim at night), `dark` 0–1 (1 = a
  black mass against the stars, as the lookouts saw it). 7/8 below the waterline, a foam collar; anchors `.peak`,
  `.waterline`; actions idle | drift. Put it on the sea AHEAD of the bow (a liner at [0, 0] heading 90 sails into
  x > 134). Tested money shots: THE BERG LOOMS — camera at her bow [124, 14] alt 3.2 looking at [250, −30] look_h 24,
  fov 55 (the spires tower over the lens); the berg ahead of the whole ship — camera [560, 150] alt 7 looking at
  [200, −20] look_h 38, fov 50.
<!--needs:!src:lib/human/aboard.js:attachAboard-->
- **People on a ship**: a cast figure's `at` is a point on the ground or the sea, so a named person cannot stand on
  a deck yet. Show him from where the words put him instead: the camera AT his place looking at what he sees (the
  lookout's view from the crow's nest: `keys` 30 m up on the foremast, just ahead of it, looking over the bow), then
  cut to what happens. The liner carries its own figures (an officer on the port bridge wing, a man at the port rail
  in a mustard scarf, two gentlemen in bowlers aft).
<!--/needs-->
<!--needs:src:lib/human/aboard.js:attachAboard-->
- **People on a ship** (they sail, heel, trim, sink and go with her half after the break, standing on the deck):
  cast `{"ref": "fleet", "at": "titanic.crows_nest", "action": "point"}` (or `"on": "titanic.crows_nest"`); crowds
  `{"kind": "figure.1910s_formal", "on": "titanic.boat_deck", "count": 7, "formation": "line", "size": [10, 1],
  "action": "watch"}`. Deck points: bow, forecastle, crows_nest, bridge, bridge_wing, bridge_wing_starboard,
  well_deck, boat_deck, boat_deck_starboard, stern_deck, stern (funnels, davits and midship are refused). Optional
  `"facing": "bow|stern|port|starboard|out|in"` (defaults: the lookout, bridge, bow and forecastle face the bow, the
  boat-deck rail faces out, the stern faces aft), `"heading"` relative to the ship (180 = the bow), `"offset": [dx,
  dz]` m (+ port, + toward the bow). `camera.target: "ref:fleet"` frames him at his deck height.
- **The POV rule**: when the words name a person on the ship, PUT HIM THERE (Fleet in the nest, Murdoch on the
  bridge wing, Smith on the bridge, passengers at the boat-deck rail) and film the moment WITH him: one shot AT him
  (a push or a tracking shot at his height, "pov": "fleet"), one shot THROUGH his eyes (over his shoulder or from
  his place, looking where he looks: the berg ahead), then the detail he touches (the bell, the telegraph).
<!--/needs-->
- **Sinking**: on any ship `"action": "sink", "t0": 0.5, "dur": 19, "mode": "break", "trim_max": 34, "list_max": 6,
  "break_at": 0.546, "lights_out_at": 13, "final": "under"` (or the same keys inside `"sink": {...}`). Modes:
  `break` (the liner's default: the bow settles, the forecastle goes awash, the boat deck floods, the stern rises to
  trim_max, the lights flicker and die at lights_out_at, she breaks between funnels 3 and 4, the bow dives, the stern
  falls back, stands vertical and slips under), `bow_first`, `list`, `capsize`. Every stage is a fraction of its
  `dur`, so a 6 s sink plays the whole story fast: for the rising stern in a 3 s shot give the sink a long `dur`
  (e.g. 40) and start the world late with `"clock": {"offset": 24}`; for "lights out" put `lights_out_at` inside the
  shot. The water shows a foam ring, a churned patch and planks/crates. Tested view: camera [−40, 520] alt 22
  looking at [−20, 0] look_h 14, fov 40.
- **Distress rockets**: `{"kind": "fx.flare", "from": "titanic.bridge_wing", "times": [0.8, 5.5], "height": 200,
  "stars": 16, "light": 1, "color": "white", "lean": 6}` (`"at": [x, z]` instead of `from`). Each climbs ~3.5 s on a
  smoke trail, bursts into white stars that drift down over ~6 s and lights the ship and the sea. Fire it at t 0.2–1
  so the burst lands inside a 3–5 s shot; frame the sky above the ship.
- **Lifeboats lowered from the davits**: `{"kind": "ship.lifeboat", "from": "titanic", "davit": "boat_port_3",
  "lower_at": 1, "lower_dur": 6, "row_away": true, "row_speed": 1.3, "crew": 7}` (needs the liner with `"id":
  "titanic"` in the scene; davit boat_port_1..8 | boat_starboard_1..8, fore to aft): swung out, lowered on its falls
  over `lower_dur` s, let go, then rowed away from her side by its seated crew in life jackets (`"crew": 0..12`); the
  liner's own boat at that station disappears when it goes. Without a liner: `"at": [x, z]`, afloat. For a 3 s shot
  of the lowering start the world mid-way (`"clock": {"offset": 3}`) or set `lower_at` 0 and `lower_dur` 3. Tested
  view: camera [30, −75] alt 9 looking at [44, −16] look_h 10, fov 46 (two boats from port davits 3 and 4).
- **People in the water** (groups): `{"kind": "crowd.in_water", "at": [0, 0], "count": 30, "length": 170, "width":
  60, "heading": 90, "action": "mix", "appear": [1.0, 4.0], "drift": 0.05, "seed": 5}` — faceless mannequins in white
  1912 cork life jackets, head and shoulders above the water, no gore; actions tread | float | wave (one arm up,
  calling) | mix; a disc (`radius`) or a field (`length` x `width` along `heading`); `appear` [t0, t1] = they surface
  over that window. With **wreckage**: `{"kind": "debris.wreckage", "at": [0, 0], "count": 120, "length": 200,
  "width": 70, "heading": 90, "mix": {"plank": 4, "chair": 3, "buoy": 1.5, "crate": 0.6, "cork": 1.5}, "appear":
  [t0, t1]}` (objects). Tested view: low among them, camera [−6, 8] alt 2.4 looking at [8, −2] look_h 0.2, fov 42.
  Keep it tasteful and brief: one or two shots, the cries in the narration carry it.
- **Sea state follows the wind**: `"weather": {"wind": 0}` = a glassy mirror sea (the lights reflect: the flat-calm
  Titanic night), no weather block = gentle with a trace of whitecaps, 0.5 = chop, 1 = storm.
<!--/needs-->
<!--needs:move:fpv_dive-->
- **`fpv_dive`**: `{"move": "fpv_dive", "target": "objects:0", "side": "left", "altitude": [280, 90], "pass":
  "titanic.funnel_2", "skim": 18, "height": 43, "approach": "ahead", "end": "rise", "fov": 62}` — one spline: from
  high it dives at the subject, skims its side at the pass height, then pulls up (`end` rise | away); head-on to a
  moving subject by default. 7–10 s works best: use it as the minute's hold or the cold open's hero beat; its last
  ~20 % pulls up to open sea, so let the words move on there.
<!--needs:src:core/camera.js:function T_dart(-->
  A dive that cannot fit its length is flown as an FPV dart past her instead. For the cold open's 2–3 s FPV beat use
  `fpv_flythrough` (a dart) or `tracking_low`.
<!--/needs-->
<!--/needs-->
<!--needs:move:tracking_low-->
- **`tracking_low`**: `{"move": "tracking_low", "target": "objects:0", "side": "left", "height": 3, "offset": 30,
  "lead": 0.15, "lead_end": 0.3, "look_lead": 0.5, "look_h": 12, "fov": 40}` — rides beside a moving ship at its own
  speed (speed and turn are measured relative to her, so it may skim 3 m over the sea at 11 m/s), `offset` m out
  from her side, `lead` → `lead_end` = where along her it rides (fractions of her length from the middle, + toward
  the bow), `look_lead` where it looks. THE low FPV skim along a lit hull; 2–8 s — a strong first or second shot
  of a cold open (the hero huge from frame one).
<!--/needs-->
- Whatever of this the CATALOG does not list yet does not exist: show the place, the people and the consequence
  instead (section 10).

## 9b. The ending — the payoff image
The last shot of the film is bright, readable and composed: e.g. dawn (`"look": {"time": "dawn", "sky": "clear",
"exposure": 1.25, "sun": {"az": 95, "el": 4}}`), the camera LOW (1–2 m) behind a lifeboat looking INTO the sunrise
(east, where the sun is) so the boat and its people are a silhouette against the glow, the rescue ship's lights
arriving on the horizon; a slow push or rise, 3–5 s, no text or one stamp. Never a dark night frame, never boats
too small to read.

## 10. 3D superpowers — recipes (declare them as "power")
- **bullet_time** — freeze the instant and move through it: `"clock": {"offset": 14.0, "freeze_at": 0.9}` (the world
  eases to a stop 0.9 s into the shot) or `"clock": {"offset": 14.0, "rate": 0}` (frozen from the first frame), with
  an `orbit` or a slow `keys` arc around the frozen event (the berg against the bow, the stern at the break). The
  camera, the text and the narration keep running. 2.5–4 s.
- **time_compression** — the world races while the camera holds: `"clock": {"rate": 30}` (any plain rate; `keys`
  rates stop at 8): a 90 s `sink` in 3 s, the boats spreading over the sea, a drift of ice. The camera is a slow
  `keys` push or a locked-off wide with a 5 % lens creep. Say the time span in a stamp ("2:20 AM").
- **scale** — data made physical: 2,224 people as a block of figures (`groups` `figure.1910s_formal`, `"count":
  2224`, `"formation": "square"`, `"size": [70, 45]`, on a dark `plains` set at night) with the 20 lifeboats beached in
  a row before them (`ship.rowboat`, `"beached": true`) — the boats hold half; a `crane_down` or a slow `reveal_rise`
  over the block, a stamp "2,224 ABOARD" / sub "SEATS FOR 1,178". Or the ship beside something known (a
  `landmark.tower`, a town) for her size.
- **impossible_pov** — from where no camera stood: the iceberg's view of the bow coming (`keys` at the berg,
  alt 15–25, looking at the approaching bow); through the rigging (`keys` between the foremast stays); one lit
  porthole the camera follows (`target` a ship anchor, `keys` + `"track": true`) until `lights_out_at`.
- **globe_dive** — from space to the one ship, two shots joined by a whiteout: shot 1 `"world": {"biome":
  "space"}`, `{"kind": "space.earth", "lon": -50, "lat": 41.7, "clouds": 0.6}`, a `push_in` on it,
  `"transition": {"out": "whiteout"}`; shot 2 the ocean, a `crane_down` from 300 m onto her, `"transition": {"in":
  "whiteout"}`.
- **then_now** — the same camera keys on the same place at two times (the lit liner sailing -> the empty sea at
  dawn; the ship -> the wreck), joined by a DISSOLVE: `"transition": {"out": "dissolve"}` on the first shot and
  `{"in": "dissolve"}` on the second (0.8 s cross-fade, made in the assembly). Or a hard match cut. Once a film.
<!--needs:param:ship.liner_1912:cutaway-->
- **cutaway** — the hull opened like a drawing, the compartments flooding one by one: on the liner with `"action":
  "sink"`, `"cutaway": {"side": "starboard", "compartments": 16, "flood": [{"t": 0, "n": 0.4}, {"t": 2.2, "n": 5},
  {"t": 6.3, "n": 7}], "water_level_rise": true}` (`flood` = how many compartments are full at time t). The camera
  broadside on the opened side, level with the waterline, a slow push: the reason she sank, at "five compartments".
<!--/needs-->
<!--needs:move:dive_under|fx.underwater-->
- **underwater** — below the surface: `{"move": "dive_under", "target": "objects:0", "side": "left", "height": 4,
  "depth": 14, "start_dist": 90, "end_dist": 62, "look_depth": 22, "cross": 0.4}` (the camera dives through the
  surface — `cross` = when, as a fraction of the shot — and looks up at the hull or the berg's hidden 7/8), or
  `"underwater": true` on any move; a scene with no sea kind adds `{"kind": "fx.underwater"}`.
<!--/needs-->
<!--needs:wreck.*-->
- **wreck_today** — the wreck on the seabed: `{"kind": "wreck.titanic", "at": [0, 0], "part": "bow|stern|debris|all"}`
  on `"world": {"biome": "plains", "relief": 0, "vegetation": 0}` with a night look (the camera carries the lamp:
  the dark seabed, the lit bow rail). A slow `keys` glide or push; a cold open that jumps to the night, the ending, or
  a then/now dissolve from the sailing ship to her wreck.
<!--/needs-->

## 11. Not in the kit (don't promise them in a shot)
<!--needs:!~iceberg-->
- icebergs or sea ice floating in the ocean;
<!--/needs-->
<!--needs:!action:ship.liner_1912:sink-->
- a sinking or broken liner;
<!--/needs-->
<!--needs:!fx.flare-->
- distress rockets;
<!--/needs-->
<!--needs:!crowd.in_water-->
- people swimming or in the water;
<!--/needs-->
<!--needs:!ship.lifeboat-->
- lifeboats being lowered from the davits;
<!--/needs-->
- faces, readable signs other than prop.sign, logos, animals not in the catalog, named real buildings, people
  standing ON a ship's deck (the liner's anchors carry cameras, flares and boats, not walking crowds). Show what IS possible instead: the place, the
  people's reaction, the consequence, the empty sea, a label, a route — never a wrong stand-in.
