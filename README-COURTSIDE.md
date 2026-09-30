# COURTSIDE — sports documentaries

`styles/courtside.json`. Sports and NBA stories cut like a streaming film: real footage, real photos of every
person named (never AI pictures), old newspapers animated on screen, Kodak contact strips, an old television
for archive shots, black-and-white film maps, article lines over darkened photos, stats tables, chapter cards
with a VHS glitch, real interview clips with their own sound, and dramatic or inspiring music that follows the
chapters. The grade is a VHS tape for the old stories; drop `look.vhs`, `look.overlay` and `look.overlay_png`
for a clean modern look (a young star like Lamine Yamal).

## The script comes first

The outline and script prompts carry the craft of the best sports documentaries (a present-tense cold open with
the identity held back, the bridge "to understand X you have to go back to Y", one humanising detail per act,
numbers paired with consequences, contrast pairs, one scene of humiliation, the irony fate hands the story, a
reframe from someone else's mouth, a thesis line that recasts the title). Two things the script writes for the
edit:

- `## Chapter Title | dramatic` — a chapter card, a pause in the voice, and the music mood of that chapter
  (`dramatic`, `inspiring`, `quiet`; tracks in `assets/music/courtside/<mood>/`).
- `[[mood: inspiring]]` on its own line — the music turns here, inside a chapter (a chapter's `| mood` is the mood at
  its start); placed on the voice by `cinema.place_moods` → `moods.json`, read by `sfx._bed_moods`.
- `[[clip: Martin on being laughed at for driving a UPS truck]]` on its own line — the edit finds the real
  interview on YouTube (word-timed captions), cuts it with its own sound and opens the narration for it
  (`soundbites.py`). `look.soundbites.quotes` says how many; `montage: true` opens the film on three or four
  people saying the subject's name.

## What the director can use here (on top of the Documentary tools)

| Tool | What it shows | Where it lives |
|---|---|---|
| `matchcut` | 6–10 real photos of the main person cut fast, every face landed on the same spot at the same size (a blurred copy behind a tight portrait), a white flash and a real shutter on every cut, the riser into the last one, which holds with a slow push (4.6 s); faces found one photo per look (`photofx.face_box`), designed graphics dropped | `photofx.py` `matchcut_scene`, `page.js` type `matchcut` |
| `textcut` | a text match cut: 3–5 punches of text (the numbers and words that hit in a passage), one per hard cut, each snapping onto the same spot of the screen over a different real photo of the subject, a chroma snap and a white flash on the cut, a hit under every cut, the last line held (5 s) | `photofx.py` `textcut_scene`, `page.js` type `textcut` |
| sound-up | a footage moment in the hook that plays with its own sound (a dunk, a roar, a buzzer), the narration pausing for it — chosen from the shot logs, cut at a sentence end, a whoosh in and a hit out (`look.soundbites.soundups`) | `soundbites.soundups`, `_sentence_ends` |
| `strip` | a Kodak 35 mm contact strip of 2–3 real photos: quick zoom-out under a second, light leak, a click on every change, the whole scene at 15 fps | `photofx.py` `strip_scene`, `assets/photofx/page.js` |
| `press` | an old newspaper — the real scanned page or clipping when an image search finds one, else a typeset AP wire story with the real photo halftoned; the camera pushes in on the headline | `headlines.py` `press_page`, `page.js` variant `press` |
| graphic `place` | the city card (CHICAGO / ILLINOIS), footage sharp in a band, soft above and below | `docgfx.py` |
| graphic `pull` | one real sentence from a real article over the real photo, with writer, outlet and date | `docgfx.py` (photo via `photofx.source_photo`) |
| graphic `table` | 2–5 rows of real numbers counting up | `docgfx.py` |
| map skin `film` | white land on grainy black, dark neighbours, the place in a hand-drawn red dotted ring, names in handwriting (Caveat) | `maps.py`, `assets/maps/map.js` |
| spotlight `tilt` | a tall portrait the camera travels down, top to bottom | `look.photofx.spot_move: "tilt"` |
| TV `retro` | a 1970s American console TV for every n-th archive shot | `look.cinema.tv`, `assets/cinema/tv_retro.jpg` |

Real recordings stand in for the synthesised cues wherever the channel ships them: `assets/sfx/es/` holds the
Epidemic pack (shutter_02, shutter_canon, whoosh_short, crowd_cheer, crowd_jubilant, hit_clean, cinematic_hit,
cinematic_riser, mouse_click); `sfx.file_sounds(name)` finds every file named `<cue>` or `<cue>_*`.

Depth pop runs without the white keyline (`look.photofx.keyline: ""`). Chapter and place cards get a chroma-split
glitch on entry (`look.docgfx.skin: "vhs"`). Sound effects for all of it are synthesised in `sfx.py` (`shutter`,
`click`, `tape`, `static`).

## The rules Robin set (2026-09-20)

- **The opening montage is real interviews only.** People on camera saying the name — a talk show, a podcast, a
  press conference, a speech. `soundbites.py` has Claude choose the moments (a whole positive sentence about the
  man first), looks at three frames of every cut — first, middle, last (`_on_camera`) — and drops animations, title
  cards, game footage and B-roll; a cut that opens on a title graphic is trimmed to the name, a cut that drifts into
  B-roll is out, and when nothing passes there is no montage (never a rejected cut kept to have one).
  A cinematic hit on the first frame and on every cut, the riser into the last one, the name box centred, a fade out.
- **Labels are centred** (`look.labels: "center"`): names lower-middle in the display face with an orange rule and
  the role beneath; figures big and counting up; phrases as a display line with a rule (no orange box — disliked).
  Places and dates keep the top-left tracked stamp Robin liked in v1. Year cards snap in with a chroma split
  (`look.cinema.vhs`) and never sit on a photo scene.
- **Maps show the whole country first** — a held, slowly settling frame of the country for most of a second, one
  smooth ease-in-out flight down to the place, then the camera bends and pushes in on it for the rest of the scene
  (`approach`, `settle`, `orbit` in `assets/maps/map.js`, film skin only).
- **Newspapers must say what the narration says.** A real clipping (Bing Images through Chromium, downloaded through
  the browser session) only when it reports that fact; otherwise the page is printed by gpt-image-2 from the wire
  story with the real photo of the person in halftone (`_press_generate`, read back by Claude — the headline has to be
  right letter for letter); the HTML typeset page is the last resort. The camera lands close on the print and drifts
  down the column, like the reference.
- **Stock-library previews never get in**: titles and channels with footageforpro / Pond5 / Shutterstock / Getty /
  CriticalPast are skipped in the search (`youtube.SKIP_WORDS`) and the shot log marks `text: watermark`.
- **Interview clips must show the person speaking** (the same three-frame check; a clip that drifts into B-roll is
  cut where it drifts) and are quoted under the picture in an old
  documentary's italic serif, timed to the words. A chapter card never bumps a clip: it moves behind it.
- **Music lower than the voice** (`music_rel_db: -7`, `duck_db: -8`); the tracks in `assets/music/courtside/<mood>/`
  are Robin's own, each levelled to −20 LUFS before the join (a quiet cue followed by a full piano piece made the
  second track jump). The cold open is always dramatic (`look.sound.opening`), then the chapters' moods; the first
  track of a shelf is named in `look.sound.lead_tracks` (dramatic documentary → winning documentary), the rest of
  the shelf follows. **Fewer television shots**, and four different camera moves inside the set.
- **Real photos come from Bing Images through Chromium** (`photofx.bing_photos`) whenever Algrow's search — which
  hands back 500 px copies — leaves fewer than six pictures big enough for a film frame; a photo is only picked when
  its caption names the person.
- **No AI pictures** except the printed newspaper page: `look.photofx.draw_objects: false` keeps the image model away
  from objects. Real photos of the person carry the chapter cards.
- **A map on the first place of the cold open** (Washington, D.C.), inside the first 15 seconds.

## How a render runs, and what to check

1. **Facts first.** The script step writes `script.txt` (outline → script → a tightening pass that keeps the `##` and
   `[[clip]]` lines and a hard word limit). Read it before the voice when the story's facts matter — Robin's rule.
2. **Run** `run_pipeline(title, minutes, style="courtside", features=…)` with youtube, objects, motion, maps, spotlight,
   headlines and sound on (stock, AI images, Vox, avatar off). A two-minute video takes 20–25 minutes on a loaded Mac:
   the script, the Gemini shot logs and the footage pick are the slow steps.
3. **The pipeline checks itself:** montage and interview cuts on three frames each (one clip per look, a yes/no per
   frame, no fallback), the newspaper read-back, strip captions, the join's length against the per-file sum, a frozen
   picture after the final mux (`_picture_stalls` → muxed again, up to three times), every music track levelled.
4. **Look before sending:** a contact sheet (`ffmpeg -i video.mp4 -vf "fps=1/3,scale=320:-1,tile=8x7"`), the montage
   frames, the first map, the first newspaper, the strip, both chapter cards, and `volumedetect` per music stretch.
5. **A short join or a frozen picture means the disk.** `df -h`, `uptime`; free space (old `output/` jobs are
   0.5–1.7 GB each); then `python rerender_timeline.py <slug>` rebuilds the timeline from the cache for nothing.
6. **One wrong slot in a finished job** is swapped in place: edit that entry in `plan.json` (a photo slot is
   `["photo", path, false, seconds]`), delete its `segments/seg_NNN.mp4` and `video.mp4`, re-run the assembly with
   force off. The montage can be rebuilt from `soundbites/montage/say_*.mp4` into the same slot (the slot runs to the
   next scene; the narration starts where the voice pause ends).

## Lessons from the Haywood samples (2026-09-20 → 21)

Six renders and one in-place repair; each of these is now code, and the list lives in `styles/courtside.json`
(`rules`, `process`, `lessons`) so the style carries it.

- **Check at selection time, never after the render.** Two non-interview cuts and three watermarked stock shots were
  only seen on the finished video. The montage's "a montage beats no montage" fallback is gone; stock sellers never
  enter the search; the shot log marks watermarks.
- **One clip per vision call.** A dozen frames in one call slipped their numbering (an answer came back 0-based) and
  approved game footage. Three frames of one clip, a per-frame `pass`, is right every time on the eleven test cuts.
- **The disk, not the codec.** A 98 %-full disk under a load of 46 answered reads with `Operation timed out`: the join
  stopped early, the final mux held the last frame under the looped overlays, treatments fell back to plain footage.
  It looked like a colour-tag or concat bug for an hour. Guards: `_warm_read`, `_segments_seconds`, `_picture_stalls`.
- **Level the sound at the source.** A talk-show cut sat 20 dB under a Zoom interview; a quiet dramatic cue followed
  by a full piano piece made the second track jump. `loudnorm` on every soundbite wav and on every mood track.
- **A style change during a render does not reach the running job** (styles load at process start; `sfx` imports
  lazily, so its code did). Re-mix a finished job's sound with `sfx.mix` and mux it under the picture instead.
- **One Playwright at a time per thread.** Bing photos inside the newspaper module's browser failed with "Sync API
  inside the asyncio loop"; `photofx.bing_photos` now runs in a thread of its own when a loop is running.
- **Newspapers must be about the claim** (a real clipping about a fight story was worse than a drawn page), and a
  drawn page may only carry the wire sentences — the first draw said "unanimous" for a 7–2 vote and invented a masthead.
- **Algrow's image search returns 500 px copies** — strips had one photo until Bing through Chromium; a photo only
  when its caption names the person (a Celtics player was once captioned as the subject).
- **Chapter cards** went near-black once and long-titled once; the tightening pass dropped the `##` and `[[clip]]`
  lines; a lead sentence made of numbers was not found in the captions — cards on real photos, 2–4 word titles,
  markers restored, a second-sentence lead.
- **Maps** waited two seconds, circled at random and opened too close to place the viewer — now the whole country
  first, one flight, bend and push.
- **Labels** bottom-left read as templated AI; the orange phrase box was disliked; the top-left dateline was loved.

- **Test render #2 (Bob Love, 2026-09-21)** caught five more: the montage took "Bob Love" from a DJ and a streamer of
  the same name (now a namesake filter on the candidate videos against who the subject is — sport and episode title —
  and "never a namesake" in the pick prompts); the montage and a chapter card silently dropped both maps, a newspaper
  and a graphic — "moved out of their way" meant *dropped*, and the move offset (0.25 s) sat inside the 0.3 s margin so
  nothing could ever move (now `cinema._make_room`: scenes settle behind or in front of a card or clip by worth, and a
  drop is named in the log); the question graphic was an orange box (a display line with a rule on the tape look); a
  rejected drawn newspaper fell straight to the typeset page (drawn once more first); a 1968 page carried a photo of
  the man at eighty (the photo pick prefers era-true pictures).

## Try the pieces without a video

```bash
python docgfx.py preview --style=courtside preview/some_frame.jpg   # place, pull, table, chapter in this look
python maps.py show "Mississippi" --title "Silver City" --skin film
python sfx.py preview                                              # every sound, including shutter and tape
python soundbites.py find "Spencer Haywood"                        # which interviews have captions to cut from
```

## The reference sample

`output/bob-love-the-nba-all-star-who-washed-dishes-for-4-45-9e5ba8/` — Bob Love, 2:04, the second test (2026-09-21).
`output/spencer-haywood-the-rookie-who-beat-the-nba/` — Spencer Haywood, 2:35, the sixth render of 2026-09-20 repaired
in place on 2026-09-21 (montage, three photo slots, music). The earlier five (`the-21-year-old-…`, `how-a-21-year-old-…`,
`…-supreme-cour-0164da`, `…-sued-the-nba-and-won`, `…-changed-bas-b8b698`) are the steps that got here.
