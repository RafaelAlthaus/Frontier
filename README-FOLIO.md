# FOLIO — the illustrated explainer

A Frontier channel where the whole video is an illustration drawn in code — the look of a picture book coming to life.
The look is written down in [`assets/folio/LOOK.md`](assets/folio/LOOK.md) — the picture, the palette, the type scale,
the camera and the eleven kinds of transition — and every prompt follows it word for word.

**Sample:** `samples/folio.mp4` — *How a Librarian Measured the Earth* (0:34), made from its title, with two shots
redrawn with a note (see *Fixing one shot*).

## What a FOLIO video is made of

- **Every shot is drawn by Claude.** Claude Opus writes each shot as a small JavaScript program against the FOLIO
  runtime; Chromium renders it frame by frame. No footage, no stock, no AI pictures — nothing to license.
- **One look:** flat vector shapes with soft two-stop gradients, outlines in a darker shade of their fill (never black),
  one warm light you can see (a lamp, a window shaft, the sun), depth of field, atmospheric haze.
- **The same people all film:** the director writes every recurring person once (age, hair, beard, clothes, colours);
  the rig draws them identically in every shot — walking, pointing, thinking, reacting on the words.
- **Words only where the voice needs help:** a place and its year (serif, top right), a person's name beside them, a
  date, callouts on the parts of an object, numbers that count up, chips for measured quantities, a quote card, a
  struck-through wrong idea, an end title. Two faces: EB Garamond (old-style figures) and Nunito.
- **Paper for every "how":** cream grid paper, sepia line art, blue for motion and forces, orange for the answer, red
  for what was wrong, "Fig. 1".
- **Transitions made with the camera:** whiteout into clouds, a warm bloom, a push into an object, whip pans, tilts,
  a paper sheet sliding over the scene or away from it, a wall panel wiping in, dissolves.
- **Sound:** a calm female narrator at an unhurried 162 words a minute, a written score (felt piano, string
  pad and bass in D major, synthesised — no music file), a few sounds of each place, mastered to −14 LUFS.

## How it runs

`styles/folio.json` sets `look.visuals: "folio"`, so Frontier hands the whole picture to `folio.py`:

1. **Storyboard** (beside the voiceover): Claude reads the script and writes the cast and a shot list — setting, light,
   who does what, the hero object, the camera, which words land on which spoken words, and the transition out.
2. **Timing:** the shots are laid on the narration word by word (whisper), cuts sit in the pauses.
3. **Drawing:** Claude writes one program per shot (three at a time), knowing its exact length and when each word is
   spoken. Every program is run at once: an error goes back to Claude with the message (twice at most), and an art
   director (Claude looking at three frames of the shot) asks for one rework if something a viewer would notice is
   wrong — a floating figure, text over a face, an empty corner.
4. **Rendering:** Chromium, 1920×1080, 30 fps, at most two browsers, one render at a time on the machine (a lock),
   motion blur on fast moves.
5. **Joining:** the shots overlap by their transitions and are blended frame by frame into one picture.
6. **Sound:** `folio_sound.py` writes the score to the edit (it resolves on the last word), adds the places' sounds and
   the transition sounds, and masters the mix. Put your own tracks in `assets/music/folio/` to use them instead.

## The runtime (`assets/folio/`)

| File | What it gives a shot |
|---|---|
| `core.js` | layers with parallax and depth of field, the camera, word timing (`S.at("phrase")`), transitions, cover-to-camera backgrounds |
| `fx.js` | lamp glow, light shafts, dust in the light, bokeh, haze, glints, the bloom and whiteout transitions |
| `hud.js` | every word on screen: place, date, name, callout, counter, stat, strike, write, quote, chip, Fig., calendar, chart card, title |
| `diagram.js` | paper sheets, ink line art that draws itself, arrows, block arrows, rotation arrows, angles, streamlines, watercolour blobs |
| `people.js` | the character rig: one definition per person, poses, walk cycles, looks, expressions, blinks, held props |
| `sets.js` | skies, clouds, terrain, water, vegetation, ancient and 1900s architecture, interiors, space |
| `props.js` | the objects narrations name: lamps, scrolls, books, tools, instruments, vehicles, animals, ships |
| `examples/` | finished shots the illustrator is shown as the standard to draw to |

Each file starts with a header listing its functions — that header is what the illustrator is given.

## Fixing one shot

A shot you don't like is redrawn on its own, with a note the illustrator must follow; everything else stays cached:

```bash
python folio.py redo "<job folder>" --t s09 --note "Show the 7° angle big and clear at the top of the rod."
```

Then make the video again (the app's re-render, or `folio.assemble`): only that shot is drawn, reviewed and rendered,
the film is joined again and the sound is remixed. Notes live in `<job>/folio/notes.json`.

## Developer commands

```bash
python folio.py still  assets/folio/examples/shot_fig_lift.js --dur 6 --t 0.5,3,5.9      # stills of one shot
python folio.py render assets/folio/examples/shot_fig_lift.js --dur 6 --out /tmp/lift.mp4 # one shot as video
python folio.py check                                                                      # the runtime loads
```

## Cost and time

Every Claude call goes through your Claude Code login (your Claude plan) as a lean `claude -p`: no CLAUDE.md, no memory,
no tools, no MCP — ~700 tokens of overhead. What costs is FOLIO's own context: the look, the whole runtime API and the
finished examples (~24 k tokens). It sits in the SYSTEM prompt, identical for every drawing, fix and rework, so after the
first call of a video the rest read it from the cache at a tenth of the price; review and rework pictures travel inside
the message (one turn, no Read tool), so they share that cache too. Each run writes its real spend to
`<job>/folio/cost.json`.

Measured on a 77-second video made from a title with the release zip (22 shots; Opus 5.5 at API list prices — on a
Claude plan this is usage of your weekly limit, not money):

- **A shot, all in** — the drawing, about two art-director looks, about 1.5 reworks with the picture, now and then a
  fix: ≈ $0.40. Reworks are the biggest part of the bill (about 60 %); a single call: drawing ≈ $0.10, look ≈ $0.025,
  rework ≈ $0.18.
- **A minute of video** (about 17 shots): ≈ $7; ten minutes ≈ $70 — roughly 2 % of a Claude Max 20x week (estimated
  from the plan's limit, not measured on a plan).
- **Voice:** ai33, ≈ 1.3 credits a character. Music, effects, fonts and rendering: free.
- **Time:** drawing ≈ 1 minute per shot with three shots drawn at once; rendering ≈ 2.5 s per second of video; with
  the script, the fact check and the voice before it, about 20 minutes per minute of video — a 10-minute FOLIO takes
  3–4 hours.

Also worth knowing:

- **Faster drawing:** `look.folio.writers` in `styles/folio.json` (3) is how many shots Claude draws at once. More
  finish sooner for the same money, if your plan takes that many calls at once.
- **Not on the render farm.** A farm machine has no Claude Code login, so it would buy every drawing from the API
  without the cache; the app refuses FOLIO jobs there — make them on this computer.
- **With an API key instead of the login** (`CLAUDE_PROVIDER=anthropic`): the same calls are billed at these prices,
  and the look is sent whole with every call (no cache) — expect roughly 1.5–2× as much.
