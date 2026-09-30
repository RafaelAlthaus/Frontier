# Seven look kits — seven channels that look nothing like each other

Every style below is a complete design system: its own fonts, palette, caption style and placement, its own way of
framing footage, its own graphics language, its own maps and sounds. Pick one in the app, type a title, press
Create. Each ships with a one-minute sample in `samples/`.

| Style | For | Captions | Footage sits… | Signature graphics |
|---|---|---|---|---|
| **DOSSIER** | true crime, internet mysteries | typewriter, bottom-left, a black bar that fills in | as a tilted print on an aviation chart, EVIDENCE-stamped with a case number, a torch beam sweeping over it | typed CODE RED alerts, red crosshair on the evidence, gold serif name, tracking box + mugshot, two-colour police/suspect dialogue, document stacks, big typed years; yellow typed labels top-right |
| **KINETIC** | essays: psychology, business, dating, culture | kinetic typography: 3–6 words build word by word beside the picture, left then right, the key word bigger and yellow, a negative word red, a sentence's last word in serif italic | pinned to a chalkboard inside a chalk-drawn frame, the line written under it in chalk; stills drawn in the style of the sketched lightbulb, revealed by a sweep and boiling like traced animation | one huge word on each spoken word, chalk icons that draw themselves, the board with a clip, phone cards, a comment with phrases highlighted, headlines scrolling, sources typed; yellow-boxed labels top-centre |
| **ATLAS** | history explainers | comic bold with a dark outline, pops in | as a sheet of paper taped to a cartoon wall; every other drawn still set in motion (Seedance) | a sunburst title card with the story in a badge, TIME MACHINE bar mid-frame, a flipchart of eras with an icon per page, wristwatch with the year, paint-wave wipes that reveal the next picture, scoreboards, signposts; cartoon maps; comic labels top-left; few, quiet sounds |
| **DEEP** | submarines, spy missions, aircraft, rockets | small condensed caps, bottom | real YouTube footage only (no AI stills), inside a dark teal monitor with a timecode, black bars cropped away | stencil datelines, abstract route charts, cutaways with glowing crew, sonar contacts, classified readouts, the map room; two-tone maps with a white route; stencil labels top-left |
| **NEWS** | wars, crises, elections, geopolitics | clean lines on a dark band, never over the news band | opens on three seconds of the channel's presenter at his newsroom desk; footage in a navy broadcast band: red BREAKING tab, the headline strip, a LATEST crawl | broadcast lower thirds (red tag, white headline band, black source band), heat maps, arrows between named places, boxed place labels, a dated timeline of events, tickers, figures with a sparkline; black-boxed labels bottom-right |
| **LEGEND** | "X reveals the 5 …" — the story in the star's own voice | serif lines, bottom (the opening interview has its own) | centred over a blurred copy with a cream keyline; a yellow-bordered close-up inset slides in | opens on a REAL interview clip; the voice is cloned from it and the script continues in the first person; numbered chapter cards, lower thirds, scorecards, the narrator's own line, dated years; a real photo of every person named; serif labels bottom-centre with a gold rule |
| **HUSTLE** | side hustles, online business, money | 2–4 big words popping at the bottom with a glow, key word red | on a flat blueprint grid with a drop shadow; real objects on a cork board | one 2D character, one thing per picture, real platform pages as headlines, DIFFICULTY LEVEL bars, real 3D-rendered icons, real bills raining, counters, versus, checklists; a hissy voice is denoised automatically |
| **HORIZON** | data documentaries: demographics, economies, how a country changes | none | full frame, real news footage of the actual places and people | numbers from World Bank and UN data drawn on navy: a line chart the camera follows as it is drawn, population pyramids turning over to 2100, generations shrinking row by row, odometer figures, country bars, a budget typed digit by digit, real documents with their translation, quotes typed as they are read, chapter tabs; real headlines with a maroon marker; `README-HORIZON.md` |
| **FOLIO** | explainers: how an invention, a discovery or an idea came to be | none | no footage at all — every shot is an illustration Claude draws in code, with parallax, depth of field and one warm light you can see | the same characters all film, places and years in serif labels on the spoken word, numbers that count up, cream-paper diagrams ("Fig. 1") for every "how", whiteouts, pushes into objects, whip pans and paper sheets as transitions, a score written to the edit; `README-FOLIO.md` |

## Try a style's pieces without a video

```bash
python kits.py preview dossier            # every scene of the kit -> preview/kits/dossier_*.mp4 + .png
python kits.py preview all
python frames.py crt some_clip.mp4        # one footage treatment -> preview/frame_crt.mp4
python maps.py show "Ukraine" --skin heat # a map in the FRONTLINE skin
python sfx.py preview                     # every sound, the new ones included
```

## Making one yours

A style is one file, `styles/<name>.json`. The parts you are most likely to touch:

- `voice.voice_id` — pick another narrator (`make_video.algrow_voices(search="deep")` lists them).
- `look.captions` — `mode` (`cluster | typewriter | shout | pop | comic | pill | stack`), `font`, `size`, `accent`, `box_colour`,
  `words` (how many words a shout or a pop shows), `left_x / right_x / top` (where clusters sit), or `"off": true`.
- `look.cinema.frame` — how footage sits in the frame (`blurfill | print | page | stage | crt | monitor | news |
  paper | player | board`) and `frame_every` (every n-th shot; 1 = all); `cinema.ground` swaps the generated ground under `stage`.
- `look.labels` — where and how the director's text labels sit (`pos`, `font`, `size`, `colour`, `box`, `rule`, `enter`, `upper`):
  every style has its own corner and face, so no two channels share one.
- `look.animate` — set every n-th still in motion with Seedance (`every`, `seconds`, `max`, `prompt`; ~$0.12 a clip).
- `look.avatar` — the channel's own presenter opens every video (`id` from `assets/avatars/avatars.json`, `seconds`,
  `provider`); NEWS ships `anchor`, a man at his newsroom desk, for three seconds.
- `look.style_image` — a drawing the image model copies the STYLE of on every still (KINETIC: the sketched lightbulb).
- `look.footage_taste` — one line on the look of the stock footage this channel wants (KINETIC: aesthetic, moody, slow).
- `look.captions.mute_under_frames` — no captions over framed shots that already write the line (the NEWS band).
- `look.maps.skin` — `chart | twotone | heat | cartoon` (or the documentary skins `midnight | paper | clean | film`).
- `look.footage_grade` — the colour grade of every shot (an ffmpeg filter string).
- `pacing.hook_notes` / `pacing.body_notes` — what the director should use when: the rhythm of the edit.
- `prompts.outline` / `prompts.script` — the voice of the channel.

The scene designs themselves live in `assets/kits/<kit>.js` (one `build()` and one `frame(t)` per scene type, every
frame computed from `t` alone) and the list of what a kit offers in `kits.py` (`KITS[...]["prompt"]`, which is what
the director reads). Add a scene there, run `python kits.py check`, then `python kits.py preview <kit> <type>`.

## LEGEND — how the cloned voice works

1. Claude reads the title and names the person speaking in it ("Michael Jordan Reveals the 5 Toughest Defenders").
2. `soundbites.py` finds their interviews on YouTube that have word-timed captions (free).
3. Claude picks 12–28 seconds where THEY speak, on camera, about the theme — clean speech, complete sentences.
4. The clip is cut with its sound. Its audio is cloned on Algrow (`POST /api/voices/clone`, up to 30 s of audio;
   the Professional plan allows 15 clones). The clone is remembered in `assets/legend/voices.json`, so the same
   person is never cloned twice.
5. The script is written in the first person, continuing straight from the words of the clip; the clone speaks it.
6. The clip plays at the very start with its own sound; the narration follows. The person is never shown again.

Without an interview with captions, the style's stand-in narrator speaks and the video is still made.

## The look under the hood (what makes it not cheap)

- **Motion blur on every kit scene**: each frame is the average of three sub-frames across a 180° shutter
  (`kits.SHUTTER`), so fast entries read like After Effects, not like slides.
- **Big text arrives with a blur-in and an overshoot**, then settles; icons fly in from far away and float; a light
  sweeps across the 3D props once.
- **Grounds are generated once by the image model** (`assets/kits/frames/gen_*.jpg`): the chart on a lit desk, the
  glossy studio floor, the blue grid, the submarine console with a blank screen (the footage is placed inside the
  detected screen), the cartoon wall, the cork board, the chalkboard, the dark creator studio, the sunburst title wall.
  Regenerate one by deleting it and running any frame treatment.
- **Captions never fight the footage**: every style's captions sit at the bottom in their own face; KINETIC's pop turns the key word yellow, DOSSIER types into a black bar.
- **HUSTLE props** (`assets/kits/hustle/*.png`) are 3D renders drawn once and cut out — add an icon by adding a
  prompt to the PROPS table in the setup script and a `case` in `hustle.js`.
