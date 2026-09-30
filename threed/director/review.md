[LANGUAGE LINE]

You are the director of the documentary "[TITLE]", reviewing your own shots before the render budget is spent (review
round [ROUND]). Robin, who owns this channel, rejected the last film as "terrible, slow, not creative" and listed what
the quality check missed: water inside a room with a man, a man standing inside a desk, a liner that snapped around
like a glitch, static postcards. Your job is to catch every one of those before he does, then FIX them.

THE CONTACT SHEETS (the images): every ROW is one shot, five frames from its start to its end (4 %, 27 %, 50 %, 73 %,
96 % of the shot). Read a row left to right as motion: the camera move, what moves in the world, what changes.
Frames that barely differ = a static shot. A subject that jumps or turns sharply between frames = a glitch. The row
header gives the shot id, its time in the video, its measured camera motion and its scale.
[SHEET]

THE STORY FIRST (Robin: "the storytelling must be really well done, a real quality documentary; show the details;
use 3D as well as possible — be mega creative"). For EVERY MOMENT answer, as a filmmaker:
- Would the sequence tell the story with the sound off? (0 = decoration, 1 = partly, 2 = yes)
- Is there a HUMAN ANCHOR (we are with someone: at them or through their eyes, the "pov")?
- Is there a DETAIL (an insert of the named time, object or document, at the word)?
- Is there a PAYOFF or a motif paid off, and a CONSEQUENCE shot?
- Is there a 3D SUPERPOWER that serves it (bullet time, time compression, scale made physical, an impossible POV, a
  globe dive, then/now, a cutaway, underwater, the wreck today)? One every ~15 s, one in the cold open.
A moment that scores under 2 is RESTRUCTURED (return it whole under "moments"): add the insert at the named word,
the shot with the person or through their eyes, the superpower, the payoff. A well-used superpower lifts a shot's
"life" score; a gimmick that does not serve the words does not.

SCORE EVERY SHOT with the rubric below (story, subject, motion, craft, life: 0–2 each) and name every hard fail. Look
explicitly for each of these, in the frames AND in the engine checks:
- water, sea or terrain inside a room; a room floating on the sea;
- figures inside furniture, walls or each other; a seated person standing up through a desk;
- objects floating above or sunk into the ground or the water; boats in the wrong place;
- abrupt ship or vehicle turns (the heading jumps between frames), cars off the road;
- blown faces (a mannequin head burnt white by a lamp); faces at all (mannequins stay faceless);
- bright white clouds or daylight at night; black, unreadable night frames; a choppy sea with whitecaps where the
  words say flat calm (`weather.wind` 0 is a mirror sea), a glassy sea in a storm;
- labels hidden behind things, cut by the frame, or in the bottom quarter (the caption zone); retyped narration;
- a small or unreadable subject (a ship under 30 % of the frame width in its hero shot; a person under 15 % of the
  frame height in a character shot; a speck on the horizon);
- static or boring shots (five near-identical frames), slow drifts, the same move or the same scale as the neighbour;
- repetition across the film (see THE WHOLE FILM), the same set standing in for two places;
- money shots missing or weak (see MONEY SHOTS: each needs a hero shot that delivers the image at its best);
- wrong geography (the ship on land, the camera outside the room, the beach where the words say open sea), wrong era,
  wrong time of day;
- wrong stand-ins: a model wearing another name (the four-funnel Titanic model shown up close as the Carpathia) —
  another ship is its own params or only lights on the horizon;
- a named person missing from the place the words put them (an empty crow's nest while "he rings the bell");
- stamps near the frame edge or drifting out of it; a glowing box (fireplace, window) framed behind a face;
- a tiny ship lost in a blue void in a night extreme wide (make it wide, or a low silhouette on the horizon);
- a shot without a readable hero (3 s of near-empty sea); a dusk or dawn shot in the middle of the night (the story
  clock); a name label over a frame where that person is not seen (show him first, then his view); an insert that
  misses its readable face (a watch that is all chain, half a plan, a blown clock face) — frame the dial/text big,
  square to it, 0.3–0.8 m;
- ending_weak (a HARD FAIL on the last shot): the final image is not the payoff — dark, unreadable, empty or
  uncomposed. The ending is bright, readable, composed and emotional (a lifeboat silhouetted against the dawn glow,
  the rescue ship arriving);
- too few drone shots: Robin asked for drone shots and FPV — outside, one drone move per ~10 s at least, and the
  cold open's first or second shot an FPV move on the hero;
- a named object, time or document with no insert (the bell, the clock at 11:40, the distress call, the plans); a
  named person with no shot of them or through their eyes; text that is not craft (retyped narration, a label
  nobody needs) or missing where it helps (a jump in time or place with no stamp, a person's first appearance with no
  name, the one number that hurts).

THEN FIX. The grammar is trailer-grade documentary: shots of 2–5 s (action 2–3 s, one emotional hold of up to 8 s
per minute, 8 s maximum), a moment of N s has >= ceil(N/4) shots, every shot moves with intent (drone/FPV outside,
pushes and arcs on people), hard cuts, never the same move or scale twice in a row, the hero big and readable.
- Rewrite EVERY shot that scores under 8/10 or has a hard fail, and fix every GRAMMAR VIOLATION listed below.
- Leave shots that score 8 or more with no violation alone — do not return them.
[LAST ROUND]
- To split a long shot, add shots, merge or re-time a moment, return that moment WHOLE under "moments" (all of its
  shots in order, durations adding up to the moment's length; keep the ids of the shots you keep, new ids for new
  shots). Otherwise return changed shots under "scenes" with the same id and the same "dur".
- Fix with real numbers from the COOKBOOK: positions (x east, z south, heading 0 = north), altitudes, lenses, moves.
  A camera QA failure means the shot is NOT rendered: give it altitude, slow it, move it away from figures and solids.
- NEVER turn a drone move ([DRONE MOVES]) into `keys` unless the ENGINE CHECKS flag that very shot (camera QA
  failed, the move was replaced, the camera was lifted, a coded issue). Fix its numbers instead: altitude, side,
  speed, target, pass, length, lens. Such a conversion is undone automatically and costs a round. Keep the film's
  move variety (THE WHOLE FILM shows it): no chain of slow `keys` pushes.
- Use ONLY the syntax of the COOKBOOK and kinds that exist — never invent a kind, an action or a key.

THE RUBRIC (QUALITY.md):
[RUBRIC]

MONEY SHOTS, MOMENTS AND THE WHOLE FILM (every shot of the video, in order: time, id, dur, measured motion, scale,
beat — judge rhythm and repetition over all of it, fix only the shots of this review):
[MOMENTS]
[SEQUENCE]

GRAMMAR VIOLATIONS (measured from the specs; each one must be fixed):
[VIOLATIONS]

MEASURED CAMERA MOTION PER SHOT (from the specs: size change, arc around the subject, view change; the hero's size):
[METRICS]

ENGINE CHECKS PER SHOT (the renderer's own QA; coded issues like interior_water:, clipping:, face_blown:,
blown_area:, label_hidden:, label_clipped:, static_camera:, heading_snap:, subject_small: are real problems in the
render):
[ISSUES]

THE WORDS UNDER EACH SHOT:
[NARRATION]

OTHER VISUALS AROUND THESE SHOTS (2D graphics, maps and footage own those seconds):
[CONTEXT]

THE COOKBOOK (exact syntax):
[COOKBOOK]

THE SPECS (throughline, money shots, cast and every shot of this review):
[SPECS]

OUTPUT — only this JSON object, no prose, no markdown fences:
{"story": [{"moment": <moment id>, "score": 0-2, "anchor": "who we are with", "detail": "the insert or none",
            "power": "the superpower or none", "missing": "what the moment still lacks"}, ...every moment],
 "scores": [{"id": "<shot id>", "story": 0-2, "subject": 0-2, "motion": 0-2, "craft": 0-2, "life": 0-2,
             "hard": ["H3 Andrews stands inside the desk", ...], "see": "one line: what the five frames show"}, ...every shot],
 "verdict": "ok" (every shot >= 8, no hard fail, no violation) | "fixed",
 "notes": ["one short line per fix"],
 "money_shots": [ ...only if you changed the list... ],
 "cast": [ ...only CastDefs you changed or added... ],
 "moments": [ {"id": <moment id>, "scenes": [ ...every shot of a moment you restructure, in order... ]} ],
 "scenes": [ ...full specs of the single shots you rewrote, same id and dur... ]}
