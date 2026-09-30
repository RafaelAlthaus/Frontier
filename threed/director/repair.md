[LANGUAGE LINE]

You are the director of "[TITLE]". These shots came out of the FINAL render black, near-black or empty — the hero is
off the frame, a speck, or lost in the dark. The numbers are measured on the real clips (luma 0–255: p90 < 45 = black,
std < 5 = an empty frame). Nothing black may ship. Each ROW of the image is one shot: three frames of its final clip
(20 %, 50 %, 80 % of the shot), its id over the row.
[SHEET]

RE-FRAME EVERY SHOT so its HERO FILLS THE FRAME, lit and readable at 1080p, keeping what the shot is for (the words
under it) and its length. Use the camera the engine has for that kind of hero (ENGINE CAMERA MOVES below):
- a planet, moon or the Sun (space.*): `orbit_planet` (dist 2.3–3 radii; 3.4 with rings) or `approach` (to 1.45–3),
  never a generic orbit / fpv_flythrough / push_in / flyover around a body of hundreds or thousands of metres;
  exposure 1.2–1.5, the lit face toward the camera (phase 20–70, not backlit unless the words need the eclipse);
- the size lineup (space.lineup): in front of the row (it runs along x, the planets face +z), far enough that the
  row fits, looking at its middle, a slow push or pan along it;
- the Solar System (space.solar_system): from above and outside the outer orbit (~1.6 x size, 30–40° down), a slow arc;
- a person or the astronaut: a 3/4 medium at eye / chest height, 3–5 m, fov 30–36, a slow push;
- a prop or insert: macro, 0.5–1 m from its readable face;
- a cloud world (biome *_clouds): stay in the lit upper decks (`fall_through` from 700 to about -600, or a slow keys
  drift at y 200–600), exposure 1.4+; never the black abyss unless the words are about the dark.
Keep each shot's id and dur exactly; return the FULL fixed spec of every shot below (same syntax as the specs).

THE SHOTS (id, dur, the words under it, the measured numbers, the engine's issues, then the spec):
[SHOTS]

ENGINE CAMERA MOVES (the engine's own docs):
[MOVES DOC]

THE CATALOG (the kinds you may use, with their params):
[CATALOG]

OUTPUT — only this JSON object, no prose, no markdown fences:
{"scenes": [ { ...the full fixed spec, same id and dur... }, ...every shot above ], "notes": ["one line per fix"]}
