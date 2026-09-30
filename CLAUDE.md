# FRONTIER 4 — instructions for Claude Code

You are the setup and customisation assistant for **Frontier**, a faceless-video studio that runs
on the user's computer. The person talking to you bought it on Whop and opened this folder in
Claude Code. They are probably not a developer. Treat them as a creator who wants a channel
running this week — not as an engineer reading API docs.

**Everything you write to them is in English** unless they write to you in another language first.
Be warm, brief and concrete. People find tools like this confusing at the start: your job on day
one is to make it obvious.

---

## On the very first message — explain it, then set it up

If `.env` does not exist, or `styles/` holds only the shipped styles (`documentary.json`,
`jung.json`, `stories.json`, `_TEMPLATE.json`), the user has not set up yet. Do **not** wait to be
asked. Run the onboarding below, one step at a time, waiting for their answer between steps.

### Step 1 — Explain what Frontier is (short, plain words)

Say this in your own words, as a short list, before asking for anything:

> **Welcome to Frontier.** You give it a title (or your own script) and it makes a finished,
> edited YouTube video on your computer: script, voiceover, footage, graphics, maps, sound, captions,
> thumbnail and description.
>
> **It comes with three styles:**
> - **Documentary** (the default) — real YouTube footage of the actual events, map animations, real
>   newspaper articles, real photos and objects, Vox-style paper collage, premium graphics, sound
>   design. About **$0.50 per minute** of video.
> - **Carl Jung — dark psychology** — the original look: stock footage, AI images and animated graphics.
>   About **$1–2 for a 30-minute video**.
> - **2D Stories** — a POV story in flat 2D pictures with one consistent character. About $0.15 a minute.
>
> **Options** lists every feature a style offers, all ticked — you untick what you don't want.
> Anything shown **in red** is missing an API key; everything else still works.
>
> **The best part:** you describe *your* channel and I build you your own style from the Documentary
> one — your niche, your tone, your colours — and show you samples before you spend a cent.
>
> Setup takes about ten minutes. Ready?

Offer to show samples right away (see **Showing samples** below) — seeing the graphics is the
fastest way to understand the tool.

### Step 2 — Check their machine

```bash
python -c "import platform, sys; print(platform.system(), sys.version.split()[0])"
ffmpeg -version
node --version
```

Frontier runs the same on **Windows and macOS** — never rewrite it for one of them. Give the right
install commands:

- **ffmpeg** — Mac `brew install ffmpeg` · Windows `winget install Gyan.FFmpeg`
- **Python** 3.10+ recommended (3.9 works; yt-dlp then has to be installed separately:
  Mac `brew install yt-dlp` · Windows `winget install yt-dlp.yt-dlp`)
- **Node.js** (nodejs.org) or **Deno** — yt-dlp needs a JavaScript runtime or YouTube hides most
  formats. `youtube.py` tells yt-dlp to use Node automatically when Deno is not installed.
- Then `pip install -r requirements.txt` and `playwright install chromium`.
- On Windows: the `py` launcher if `python` isn't found, and a **new terminal** after any install.

### Step 3 — API keys: explain the choice, then collect them

They do **not** need every service. Explain the setups, then ask which accounts they already have:

| Setup | Voice | Pictures | YouTube footage | Photos/objects/Vox/depth |
|---|---|---|---|---|
| **Algrow + WaveSpeed** (recommended) | Algrow | Algrow | Algrow | WaveSpeed |
| **WaveSpeed only** | WaveSpeed (ElevenLabs v3) | WaveSpeed (Seedream) | WaveSpeed (Gemini) | WaveSpeed |
| **kie.ai + a voice service** | Algrow, WaveSpeed or ai33 | kie.ai | kie.ai (Gemini) | WaveSpeed |
| **Gemini API for footage** | any | any | Google Gemini API key | WaveSpeed |

- Algrow, kie.ai, WaveSpeed and ai33 links are on the Whop page. Gemini keys: aistudio.google.com.
- **YouTube footage** needs yt-dlp plus ONE of `ALGROW_API_KEY`, `GEMINI_API_KEY`,
  `WAVESPEED_API_KEY`, `KIE_API_KEY`. Without them the switch is red and the video uses what else is ticked.
- **Stock footage** needs `PEXELS_API_KEY` (free, instant, pexels.com/api) — the Documentary style
  doesn't use stock, the Carl Jung style does.
- Scripts are written through Claude Code itself — no key. `ANTHROPIC_API_KEY` only if they prefer the API.

Have them paste each key; write it into `.env` (copy `.env.example` first). **Never repeat a key back
in chat, never print `.env`.** Then show them what they unlocked:

```bash
python -c "import features, json; c = features.capabilities(); print(json.dumps({k: v['ok'] for k, v in c['features'].items()}, indent=1)); print(c['base'])"
```

Explain every `false` in one line: what it would unlock and which key does it.

### Step 4 — Describe their channel → build their style

This matters most. Ask for **any** of:

- the channel in their own words: niche, audience, tone, the kind of titles they make;
- links or screenshots from 2–5 videos they love (theirs or a competitor's);
- colours or fonts they like; how the narrator should sound;
- which features they want by default.

Then build `styles/<their-channel>.json` **starting from `styles/documentary.json`** (or `jung.json`
for a cheap stock-footage channel, `stories.json` for a character story channel). See **Creating a
style** below. Keep what makes Documentary good — real facts, cold open, filmable names, quiet type
— and change what makes it theirs.

Show them the result as samples (next section), adjust until they like it, and only then suggest
the first video.

### Step 5 — The first video

Suggest a **2-minute test** with a specific title in their niche. Explain before they press Create:
how long it takes (a 2-minute Documentary is roughly 15–20 minutes on a laptop, most of it finding
and cutting footage), what it costs (well under $2), and where it lands (`output/<channel>/<Video title>/` — the video, its description and thumbnails; the working files in `output/<channel>/_work/<slug>/`). When it
finishes, run `python check_video.py <slug>`, pull a few frames with ffmpeg and look at them, and
tell them honestly what's good and what you'd adjust.

### Showing samples

You can *see* what Frontier makes — use that. Render, extract frames, open them with your Read tool,
and describe what they're looking at:

```bash
python docgfx.py preview                          # the 7 documentary graphics -> preview/docgfx/*.mp4
ffmpeg -ss 4 -i preview/docgfx/3_chart.mp4 -frames:v 1 preview/chart.png
python sfx.py preview                             # every sound effect -> preview/sfx/*.wav (they can listen)
python maps.py demo                               # a map animation
python preview.py --all --no-open                 # the classic motion graphics (Carl Jung style)
```

`assets/styles/*.jpg` are the pictures on the style cards. For a new style, `docgfx.py preview`
renders in `styles/documentary.json`'s colours — to preview theirs, temporarily point `_preview()` at
their style file or pass the look through `docgfx.render(jobs, look=...)`. A finished video in
`output/` is the best sample of all.

---

## Creating a style

**One channel = one style file** in `styles/`. Copy the closest shipped style, rename it, then:

| Field | What you decide |
|---|---|
| `name`, `label`, `description` | How it reads in the app. The description also briefs the art director, the footage researcher and Vox scenes — make it concrete. |
| `tagline`, `points` | The channel card: one short line, then 3–5 bullets of what the videos are made of (a few words each). Without `points` the card shows the description. |
| `order`, `cost` | Card order in the app, and the one-line cost shown on the card. Frontier's own channels (`BUILTIN` in `styles.py`) always come first; a channel the user makes is listed after them, in its own `order`. |
| `language` | `English` unless they say otherwise. Any language works. |
| `voice` | `provider` (`algrow` / `wavespeed` / `ai33`), `engine`, `voice_id` (Algrow/ElevenLabs id), `wavespeed_voice` (a WaveSpeed ElevenLabs voice name such as `Brian`). If the named provider has no key, Frontier falls back to one that has. |
| `features.offered` / `features.on` / `features.prefer` | Which Options switches the style shows, which start ticked, and whether footage slots prefer `youtube` or `stock`. Keys are in `features.FEATURES`. |
| `prompts.outline`, `prompts.script` | **The voice of the channel.** The longest, most important fields. Documentary's are the model for a factual channel: cold open, real names/places/dates, tension, payoff, numbers written as spoken. |
| `look.graphics` | `"documentary"` for the docgfx graphics; leave out for the classic motion.py templates. |
| `look.title_font`, `look.accent` | Font stack and 4–5 hex colours. docgfx uses `accent[0]` as its gold; a bundled font must exist in `assets/fonts/` (file named like `Family-Name.ttf`). |
| `look.captions` | `font`, `size`, `upper`, `karaoke` (false = still captions), `outline`, `shadow`, `line_chars`. |
| `look.footage_grade` | An ffmpeg filter that pulls all footage into one tonal range. |
| `look.dust` / `vignette` / `leak` | `false` for a clean documentary picture (no film dust, dark corners or light-leak transitions). |
| `look.sound` | `sfx_db`, `music_db`, `duck_db`, `music` (true/false). Music comes from `assets/music/<style>/`. |
| `pacing` | `graphic_every_min` (one graphic per that many minutes), `graphic_dur_s`, `graphic_max_s`, `punch: false` (no punch-line cards). |
| `thumbnail.brief` | What their reference thumbnails have in common — see **Thumbnails**. |

After writing a style file, **verify it loads** before telling the user it's done:

```bash
python -c "import make_video as mv, motion, styles; print(styles.apply_to_engine(mv, motion))"
```

### Thumbnails — ask for 5 references

Mention this once during onboarding, and again the first time they see a thumbnail they don't love:

> If you send me 5 thumbnails from your niche — yours, or someone who's beating you — I'll work out
> what they have in common and lock it in.

Look at the images properly and write what you find into `thumbnail.brief`: where the headline sits,
how many words, weight and case; the subject and what it's doing; the palette including the
background; how much is empty; anything that repeats across all five. Be visual, not evaluative.
Set `thumbnail.accent` to the recurring colour, generate one, adjust the brief — not the generator.

---

## Running it

```bash
python app.py
```

The browser opens (`FRONTIER_PORT` changes the port). Pick a style, type a title or paste a script,
check Options, press **Create video**. Videos land in `output/<channel style>/<Video title>/`: the video (once, named after
the title), `<title> - description.txt` and the thumbnails. The working folder is `output/<channel style>/_work/<slug>/`
(`make_video.find_job(slug)` finds it; `final_video(job)` finds the finished file). `python tidy_output.py
--apply` sorts videos made by an older Frontier (flat in `output/`, the video twice) into this layout.

---

## How a Documentary video is built

`make_video.run_pipeline()` → script (Claude) → in parallel: voiceover, AI images (if on) and
`fetch_footage()` (YouTube + stock) → graphics (`docgfx.py` for `look.graphics: "documentary"`,
else motion.py) → scene modules on the words (`SCENE_DLCS`: maps, headlines, photofx, vox) →
timeline (`_build_astro_motion_plan`) → segments → sound design (`sfx.py`) → final mux with captions.

### COURTSIDE — sports documentaries (`styles/courtside.json`, `README-COURTSIDE.md`)

The NBA/sports look built 2026-09-20 from Robin's LaRue Martin references. Beyond the Documentary tools it adds: a VHS
grade (`look.vhs`, `look.overlay` tape noise in place of dust, `look.overlay_png` scanlines laid over every frame in
`_final_mux`), Kodak contact strips of real photos (`photofx` `strip`, director tool `strip`), a portrait tilt
(`look.photofx.spot_move: "tilt"`), old newspapers — a real scan found by image search or a typeset AP wire story
(`headlines` `press`, director tool `press`), the `place` / `pull` / `table` graphics and a VHS chapter card (`docgfx`,
`look.docgfx.skin: "vhs"`), the `film` map skin (white land on black, handwritten names, a red dotted ring), a 1970s
console TV (`look.cinema.tv: "retro"`), chapter moods (`## Title | dramatic` → `assets/music/<style>/<mood>/`), and
`soundbites.py`: real interview clips with their own sound where the script writes `[[clip: …]]`, plus the opening
name montage. `sfx.py` gained shutter/click/tape/static and reads any scene's `.sfx.json` marks. The script prompts
carry Robin's "fire script" craft (present-tense cold open, the bridge, one human detail per act, contrast pairs).
Finished 2026-09-21 after six Haywood renders; the style file carries its own `rules`, `process` and `lessons` blocks
and `README-COURTSIDE.md` spells them out. Engine pieces from that work, all generic: `soundbites._on_camera` (three
frames of one clip per vision call, a per-frame pass, no fallback that keeps a rejected cut; interview clips cut where
they drift into B-roll), `youtube.SKIP_WORDS` skips stock-library sellers by title and channel and the shot log knows
`text: watermark`, `cut()` levels every soundbite wav and `sfx._bed_moods` every mood track (`look.sound.opening` names
the cold open's mood, `look.sound.lead_tracks` a shelf's first track), `soundbites.ENC` carries no colour tags,
`photofx.bing_photos` runs in a thread when a Playwright loop is already running, and the final assembly guards
against a loaded or full disk: `_warm_read` before the join and the mux, `_segments_seconds` for the join's expected
length, `_picture_stalls` (freezedetect on shrunk, blurred frames) muxing again up to three times. Styles load at
process start — a style edit during a render does not reach the running job; `sfx` imports lazily, so its code does.
2026-09-21 (after the Bob Love test): `photofx` `matchcut` (director tool `matchcut`, `look.photofx.matchcut`; faces by
`face_box`, one photo per vision call, `faces.json` cache; page type `matchcut` with a blurred backdrop and a white
flash; `matchcut_marks` = a shutter per cut + riser + hit), `soundbites.soundups` (`look.soundbites.soundups`: footage
moments with their own sound at sentence ends of the hook, rows kind `soundup` with `gain_db`), `[[mood: …]]` script
markers (`cinema.MOOD`, `place_moods` → `moods.json`, merged in `sfx._bed_moods`), `cinema._make_room` (scenes settle
around cards and clips by worth, drops named), `sfx.file_sounds` + `assets/sfx/es/` (real shutters/whooshes/crowds
replace the synths), the chapter card's single entrance, the `question` graphic as a display line on the tape look,
`headlines._press_generate` drawing a rejected page once more, `soundbites._about` (namesake filter) and `_who`,
`photofx` `textcut` (director tool `textcut`, `look.photofx.textcut`: lines of text on one spot over hard cuts of real
photos), `headlines._trim_real_page` (a real page cut out of its background; under 900 px → drawn) and the press camera
clamped to the paper, `_STYLE_NOW` set at the start of `run_pipeline`.

### Channel variants (`styles/variants/`, `_pick_variant`)

A style with `"variant_of": "<channel>"` and a `"match"` sentence is a look that channel takes by itself: `run_pipeline` asks Claude once which fits the title (the channel's own description, or each variant's match) and runs the job as that style; `style.txt` keeps the choice for re-renders. Variants load with the other styles (every engine table knows them) but `styles.catalogue()` never lists them. Documentary ships `gaming` (video games: playful narrator, cut every ~2.6 s, pink/amber palette, trailer footage) and `grooming` (men's grooming and style how-tos: step and tip cards, products).

### The director (`director.py`, `look.director: true`)

A Documentary video is edited by one director, not by each tool grabbing moments on its own.
`director.plan()` reads the timed narration in stretches — the first minute as the hook, then ~2.5-minute
stretches, all in parallel — and returns, sentence by sentence, which tool shows what: `map`, `spotlight`,
`object`, `headline`, `graphic` (docgfx types), `vox` (a 7–14 s collage moment) and `text` (labels over the
footage), plus the collage `look` for this story (accent colour, stage, paper). The hook gets something on
every sentence (a dateline on the date, a map of the first place, a spotlight on the first person, a
collage between 0:20 and 1:00); after it: about one collage and one graphic per minute, photos often,
maps when a new place matters, 2–4 text labels a minute. Only tools ticked in Options are offered
(`tools_on`). Each item is timed word by word (`_find_line`; spelled-out numbers are matched against the
digits in the subtitles by `_num_tokens`). A scene's plan interval is its real one — the module's lead
before the words (`LEAD`: map 1.6 s, spotlight 0.9, object 0.5, headline 1.3, graphic 0.15) and its real
length (`GRAPHIC_S` per graphic type). Selection is greedy by worth (`rank`, minus a variety penalty within a
quarter of the video, minus 4 for the same thing twice) under a coverage cap — `pacing.scene_share_hook` /
`scene_share_body` (default 0.62 / 0.42; a short video is one stretch). A channel can open on a longer hook with `pacing.hook_s` (seconds, default 60) and add its own budget rules with `pacing.hook_notes` / `pacing.body_notes` (appended to `INTRO_BUDGET` / `BODY_BUDGET` as the channel's rules, which win — e.g. "a Vox collage every three minutes, a map for every new place"). A dateline on the same moment as a
map becomes the map's subtitle. A scene left out for room becomes a text label (`as_label`: its figure,
date, name or place), a kept spotlight gets a name label unless a label already names that person, and labels
may sit on spotlight and object scenes (never on maps, graphics, headlines or collages) — a name only on the
photo of that person. A label that finds no room on its words is squeezed into the gap (at least 2.2 s), and it
leaves soon after its sentence ends (0.3 s; a name 1.2 s), so "UNCONFIRMED" never runs into "Then it gets
official". The scene modules trust the director's spacing: in a directed video only a real collision makes a
graphic give way (without a director, maps and headlines still keep 3 s of footage around them). A spotlight, map,
headline or graphic moment may carry `"dur"` (a photo squeezed between two scenes 3.2–6 s, a map 4–7 s, a page
3.4–6.5 s), and directed pages may follow each other 0.3 s apart. A headline moment with a `"url"` (a subreddit, a
forum, a company's post the narration names) is photographed as it is, without a search.

What Robin's reviews taught the director (in its prompt): in a story about someone's relationships every partner
or rumoured partner the narration names gets a real photo on their name (the news photographed them — only private
people get labels instead); the hook has a collage inside its first 30 seconds; headlines come one or two a minute
on reported facts (statements, court decisions, lawsuits, firings, records), plus the real page when one is named;
a follow or unfollow between named people is a `social` graphic. A page capture closes a consent dialog it cannot hide by declining the
optional cookies — never by accepting. Every tool gets its moments in its own cache format (`maps/moments.json`, `photofx/moments.json`,
`headlines/moments.json`, `motion/doc_scenes.json` as `{"director": true, "items": [...]}`,
`vox_scenes/moments.json` + `look.json`, `overlays.json`). `director.json` is the whole plan.

`_prewarm_scene_plans` runs the director as soon as the voice exists and then builds every scene module
from its plan in parallel (`add_to_timeline([], ...)` renders and caches) while YouTube footage is still
being cut; the timeline step reuses those renders. "Redo everything" clears the scene work
(`_clear_scene_work`) and the tools then build from a fresh plan.

**Text labels** (`_overlay_ass`): names, places, dates, figures (counting up) and key phrases are drawn by
libass in the final burn pass — no extra render — with the style's accent, Roboto Condensed and EB Garamond
(all sans when the style's `title_font` is not the serif), over a soft blurred shade for legibility, each
for its own `dur` from `overlays.json` (at least 2.2 s, the director's shortest), never on top of a graphics
scene. A caption that only grazes a scene window (its first or last half second) is trimmed to the footage
instead of dropped. **Headline pages** move three ways (`assets/headlines/page.js` `variant`:
`window`, `paper`, `scan`), rotated per video.

### Options → the engine (`features.py`)

`FEATURES` is the list of switches. A style's `features` block says which it offers and which start
on; the UI sends what the user ticked; `features.resolve()` turns anything not offered — or whose key
is missing (`capabilities()`, which reads `.env` fresh) — off. In make_video, `_apply_features()`
maps the switches onto the older knobs (mix, motion, maps, headlines, spotlight, objects, depth) and
`feature(key)` / `_FEATURES` answer everywhere else. A job without switches for a style without a
`features` block keeps the old behaviour exactly. `set_extra()` holds the extra instructions;
`_extra_block()` appends them to every prompt that shapes what the viewer sees or hears. YouTube links in them are research: `_sources_block()` reads the linked videos' own captions (a channel or playlist link: its two videos whose titles share the most words with the title) and hands the transcripts to the outline and the script as facts to check and build on, never wording to copy (`job/sources.txt`).

### YouTube footage (`youtube.py`)

1. `plan_needs` — Claude writes a YouTube search + the wanted shot per ~30 s of narration (`needs.json`), searches in English whatever the narration's language. A channel sets the grid in `look.youtube`: `window_s`, a finer `hook_window_s` over the first `hook_s` seconds, `candidates` (videos watched per search, default 3) and `second_search` — a 30-minute documentary on 60 s windows with 2 candidates watches about a third of the videos, and each wider window simply gets more shots.
2. `search` — Algrow's `/api/search`, else `yt-dlp ytsearch`. Shorts, reactions, podcasts skipped; the two most relevant results may run 30 minutes, the rest 15. Official uploads (`OFFICIAL` channels, "official" titles) first, teasers under 45 s last.
2b. `plan_focus` — every candidate's info file is read once (its sharpest picture: under 480 lines is left out when a sharper video was found for the stretch; its captions, `transcript`). A video up to 7 minutes, or one with nothing said, is watched whole. A longer one is watched only where its own words touch what the story needs: Claude reads its captions twenty seconds at a time and returns the stretches (padded, merged, at most 8 minutes of one video); a long video that never touches the story is skipped. Algrow takes whole YouTube links only, so stretches go to Gemini (`videoMetadata` offsets), WaveSpeed or kie (a 360p copy of the stretch), best first (`focus_analysts`, `YT_FOCUS_ANALYST`); with Algrow alone a long video that touches the story is watched whole. A stretch whose log stops before its end is watched once more from where it stopped.
3. `shots` — a video model logs every shot of each candidate (`catalog/<id>.json`, stretch logs put back on the video's own clock): Algrow `analyze-video` or Gemini take the YouTube URL; WaveSpeed and kie get a 360p copy. **Times are asked for as `"MM:SS.s"` strings** — plain seconds come back wrong.
4. `usable` + `_pick` — real footage only (no presenters, interviews, graphics, big text) and a game's own
   footage (kind `game`; a game video's "animation" shots count; fan concepts by title never); Claude edits
   sentence by sentence: each chosen shot names the sentence it shows (`line` in `clips.json`); how many per
   window follows `pacing.cut_s` (default 4 s).
5. `cut_clip` — yt-dlp downloads only the shot's seconds (`--download-sections`, `--force-keyframes-at-cuts`); `_cuts` finds hard cuts, short and slow dissolves and fades (frame correlation across two frames, blend fitting, ignoring pixels that never change — black bars hide cuts otherwise); the clip keeps the longest clean stretch (at least 2.2 s; 1.4 s for a game trailer, which cuts fast by design), `_window` crops bars and burned-in logos — a logo is what stays still while the picture changes, and when the shot log saw one, also an outline that persists in nearly every frame (a translucent channel bug changes brightness with the picture under it); a logged logo nothing pinpoints still gets a push-in (1.24x moving, 1.28x still) — output is muted 1920×1080. `_same_picture` drops a clip that shows the same photo as another at a different zoom; `_too_dark` drops one that reads as a black screen.

In the timeline (`_build_astro_motion_plan` → `_take_by_sentence`), `_find_line` times each shot's
sentence word by word in the subtitles: a shot plays while its sentence is spoken (a sentence the scene
before already showed doesn't count as "now" — unless its words are still going on; between two scenes the
next sentence's shot may come up to 5 s early when everything else is stale), a slot is at most
`pacing.cut_s` × 1.5 long in a fast-cutting style, and a shot shown twice is at least 30 s apart and
reframed 1.25x from later in the shot (`footage_again.json`). When no shot fits the words, a shot of what was
already said comes back (least recently shown, not within 12 s) — never the shot of a sentence still to come,
which would show a later event early — except that a sentence 15–45 s ahead with more than five unseen shots
(the closing line often gets eight trailer shots) lends its lowest-ranked ones before anything is repeated.
A slot that would leave less than 2.5 s before the next scene shares
the room with the next slot instead of being stretched over it, so the words just before a scene get their
own shot. The pick prompt lets a sentence about the main subject that no shot shows (a rumour, a statement)
take a plain shot of that subject from the same period — never one tied to another dated event. A slot lasts as long as the shot really
does (`footage_seconds.json`), and `_render_footage_segment` never loops a real shot. Clips are also
tagged by window in `broll_tags.json` (`_win_s`) for stock-style fallbacks. `youtube_used.json`
remembers moments used in other videos. yt-dlp reads each video's page once (`_source`, info json)
and cuts sections with six workers. Try it: `python youtube.py search "..."`, `python youtube.py shots <id>`.

**Every word on the voice's clock** (`_word_clock`, run once the voice exists): faster-whisper hears the finished voice word by word (`words_heard.json`), its words are matched to the subtitle words (`words.json`, keyed by the SRT's hash) and a word heard differently takes its share between matched neighbours. `_spoken_stream` reads it for those cues (the director, labels, footage lines), and the burnt captions put each line and each karaoke highlight on its words — the old letter-weighted estimate ran up to 1.5 s off inside a long cue with a pause.

**Retention craft in every script** (`prompts.SCRIPT_CRAFT_OUTLINE` / `SCRIPT_CRAFT_SCRIPT`, `_script_craft`): appended to each channel's own outline and script prompts — story framework (character, concept, stakes; in medias res or a true contradiction) or teaching framework (target, transformation, stakes; direct question or problem), a hook of 2–3 mechanisms in ~50 words with a 5-point self-check (gap, confirmation, mechanisms, density, stakes), payoffs chained by open questions, strongest material in the middle, the title's payoff foreshadowed at the hook, a third and two-thirds, truth first. The channel's rules win; `"script_craft"` in a style pins `story` / `teaching` or turns it `off`.

**Long episodes and words a channel never says.** `"script_parts": true` writes a script of 1,800+ words part by part (`_script_in_parts`): the outline labels its beats `BEAT n`, each part covers its beats at its share of the length and reads everything written before it — a 30-minute Czech episode written in one pass came back at 14 minutes. `"script_avoid"` lists word stems the narration must not contain (e.g. "zabít", "vražd" for a monetised channel); `_avoid_words` sends each sentence holding one back to Claude once to be rewritten with the same meaning.

**Subtitles are respelled from the script** (`_script_words_into_srt`, at the end of `generate_voiceover`): the
transcription hears "Nikki Nicole" and "Aryan Kurtaj"; each subtitle word is matched to the script's own word
(timings kept, digits kept, a sentence-start capital following the punctuation really in front of it). The
director times its labels on these words, so a name the transcription misheard still gets its label.

**Voice drift:** ElevenLabs v3 can slide into a different-sounding narrator part-way through a long
request. Styles set `voice.model` (Documentary: `eleven_multilingual_v2`) and `voice.chunk_chars`;
parts are recorded in parallel and joined (Algrow needs at least 200 characters per part).

**While footage is cut:** `_prewarm_scene_plans` runs the Claude calls of docgfx, maps, headlines and
photofx side by side as soon as the voice exists (skipped on "Redo everything"), so the timeline step
finds their plans cached. Every step line in the log shows the elapsed time.

### Documentary graphics (`docgfx.py`)

Ten scene types — `dateline`, `number`, `chart`, `timeline`, `quote`, `pivot`, `question`, plus `step`
(a routine's step card on quiet grey with a photo), `card` (a white tip card, key phrases highlighted in
yellow) and `social` (two profile cards; a cursor clicks "Following" → "Follow" on each, the heart between
them splits — or the reverse for a follow; for splits, new couples and feuds going public) — designed by Claude per ~45 s part or by the director (`motion/doc_scenes.json`), each placed on the
exact words it names (`at`). A part of a whole is a number, not a chart; `of_its_time` rewrites "fastest
ever" on a graphic of an old story as "at the time". A graphic in a slot longer than itself holds before
its words fade (`_render_held_scene`), never on an empty frame.
Text must add a fact the voice doesn't say; pivots and questions are rare; "none" is allowed. Grounds
are this video's own footage, blurred (`_pictures`); charts sit on paper. Fonts are bundled
(EB Garamond, Roboto Condensed, OFL). Each scene writes `doc_NN_type.sfx.json` so the sound lands on
its animation. The page follows the same rule as every Frontier scene: everything computed from `t`.

### Sound design (`sfx.py`)

`cues(plan)` turns the finished timeline into sound events; every effect is synthesised with numpy
(band-moving noise, pitch-dropping sines, a small FFT room). `mix()` streams the voice in 5-second
chunks, adds the effects and the music bed from `assets/music/<style>/` (or a named track anywhere under
`assets/music/`: `look.sound.track` / `FRONTIER_MUSIC`), levels the bed against the voice
(`music_rel_db`, quiet passages lifted up to +6 dB), ducks it under the voice, and `master()` brings the
whole soundtrack to -14 LUFS (two-pass loudnorm, linear) in `_voice_sound.wav`, which `_final_mux` takes in
place of the narration. `look.sound.intro_s` lets the opening carry the music: `intro_db` over the first `intro_s` seconds, then `after_db` (or "off") for the rest, crossing over in `intro_fade_s`.

### Vox style scenes inside a video (`vox.add_to_timeline`)

Claude picks a few 7–14 s moments (one per ~2.5 minutes) best told as collage; each gets its own
little script and subtitles, `plan_beats` directs its shots, `make_assets` draws cutouts with a real
Wikipedia photo as reference (one stage shared by all moments), and the rendered beats are joined
into `motion/vox_NN.mp4`. The look comes from `assets/vox/defaults.json` unless the style has `look.vox`.
Real people keep their faces (no eye bars unless an element asks `redact` for an anonymous stand-in);
image prompts never carry hex codes (`_nohex`/`colour_name` — models print them); cutouts are only the
subject; filler words never become a card; words sit above the pictures; a card is centred on its x,y like
every other element (`place` measures it once it has its words); the camera never goes closer than 2x (1.6x
over a photograph — the stage and pictures are printed at screen size); `keepInView` keeps every card
readable from the moment it lands. `_draw` uses Algrow's image model first when there is a key
(`VOX_IMAGES=wavespeed` to keep WaveSpeed), accepting its transparent PNGs directly.

### Providers

`_voice_provider(style)`: the style's `voice.provider`, then `VOICE_PROVIDER`, each only if its key
exists, then the first of Algrow → WaveSpeed → ai33 with a key. WaveSpeed voice =
`wavespeed.voiceover()` (ElevenLabs v3 with timings, subtitles from the alignment).
`_image_provider()`: `IMAGE_PROVIDER` if its key exists, else Algrow → WaveSpeed (Seedream 4,
`_wavespeed_image_gen`) → kie.

---

## Making it yours — the loop

Every change, however small, goes: **change → check → preview → look.**

```bash
python check_templates.py               # did anything break? (seconds)
python preview.py <name> --no-open      # render only that animation (~10 s)
python preview.py --all --no-open       # every animation, in this channel's look
```

`preview.py` writes `preview/<name>.mp4` and `preview/<name>.png` (a late frame).
**Open the PNG with your Read tool and look at it before telling the user it's
done** — you can see what you built. To judge motion rather than layout, pull a
few more frames: `ffmpeg -ss 0.8 -i preview/<name>.mp4 -frames:v 1 a.png`.
`--all` also writes `preview/_all.png`: every animation on one labelled image.

### Adding an animation

An animation is a template: a JavaScript function named `T.<name>` inside the
page template in `motion.py`. **All four steps are required:**

1. **Write it** next to the others. Build elements with `mk(tag, className, html)`,
   then give each one its behaviour over time with `add(node, t => { ... })`.
   Start by copying the closest existing one — `T.quotemark` is a compact example.
2. **Register it in `TEMPLATES`** (motion.py). An unregistered name does not
   error: the engine silently swaps in a different animation
   (`TEMPLATES[index % len(TEMPLATES)]`), so a forgotten step looks like "my
   animation never shows up".
3. **If it shows a list** (`SCENE.items`), add it to `_NEEDS_ITEMS`, so a scene
   that arrives without items falls back instead of drawing an empty layout.
4. **Describe it in `prompts.MOTION_MINUTES_PROMPT`** — one line like the others:
   name, when to use it, its fields. That is how the scene designer learns it
   exists. Skip this and it works in `preview.py` but never appears in a video.

**The rule that breaks most new animations:** every frame is a screenshot taken
at time `t`, in any order. Everything on screen must be computed from `t` alone.

- No CSS `transition` or `@keyframes`, no `requestAnimationFrame`, no
  `setTimeout`, no `Date.now()`.
- No `Math.random()` — use `rnd()`, which is seeded, so a scene draws the same
  way every time it renders.

| helper | what it does |
|---|---|
| `seg(t, start, dur)` | 0 → 1 across a window — `seg(t, .4, .6)` rises from 0.4 s to 1.0 s |
| eOut(p), eBack(p), eInOut(p) | easing curves for that 0 → 1 |
| `lerp(a, b, p)` · `cl(x, a, b)` | interpolate · clamp |
| `headline()` · `sub()` · `hand()` · `fit()` | title, subtitle, handwritten note, auto-size text |
| `SCENE.title` · `SCENE.subtitle` · `SCENE.items[{label, text, icon}]` | the content |
| `SK.ink` · `SK.ac[0..4]` · `SK.tf` · `W` · `H` | channel ink, accents, title font, frame size |

### Adding a look

A *look* is a skin — a ground plus palette — in `SKINS` in motion.py. Copy an
existing entry, keep every key it has, change the values, then name it in a
channel's `look.skins`. A channel's font and accents come from its style file,
not the skin, so the same skin reads as a different channel in each.
Check it with `python preview.py --all --style <channel>`.

The sticker library (`assets/cutouts/`) includes a few faith-specific pieces —
a Bible, drawings of Jesus, a church (`NICHE_CUTOUTS` in motion.py). They are
never used to fill a gap: a scene only gets one by naming it. So a faith
channel's prompts can ask for them, and no other channel ever sees them. Keep
any sticker you add for one niche in that set too.

### Changing something

Say what's wrong in plain words and point at it ("the yellow bar is too thick on
the highlight"). Find it, change it, run the loop. One trap: a finished video's
graphics are cached. To see a change in an existing video, tick **Redo
everything** in the app, or delete `output/<channel>/_work/<slug>/motion/*.mp4`.

## Customising further

The user owns this code. When they ask for something the style file cannot
express, change the engine — but read the file first, because most of it is
load-bearing in ways that are not obvious:

- **`make_video.py`** — the pipeline: script → voice → pictures and footage → graphics →
  scenes on the words → timeline → sound → mux. Also the three text treatments of the classic look
  (`_render_cardtext_segment`, `_render_slit_segment`, `_render_highlight_segment`).
- **`features.py`** — the Options switches and the key each needs.
- **`youtube.py`**, **`docgfx.py`**, **`sfx.py`** — YouTube footage, the Documentary graphics, sound design.
- **`maps.py`**, **`headlines.py`**, **`photofx.py`**, **`vox.py`** — scenes placed on the words.
- **`motion.py`** — the classic Chromium scene engine: ~27 animated templates, Font Awesome icons,
  the skins. Every scene must set `window.__ready` and answer `window.renderFrame(t)` deterministically.
- **`prompts.py`** — engine prompts only. Channel voice is in `styles/`.
- **`app.py`** + **`ui.html`** — the local web UI. **`styles.py`** loads `styles/*.json` into the engine.

### Two verification tools — use them, don't skip them

```bash
python check_templates.py     # renders every motion template, reports real JS errors
python check_video.py <slug>  # checks a finished video: cadence, clip repetition, language, levels
```

`check_templates.py` catches a broken scene in seconds. Without it, a one-line
mistake in a template shows up as "the browser didn't start" after a four-minute
timeout, four retries deep.

### Things that will bite you

These are all real, all found the hard way, all still true:

- **`drawbox` does not animate.** Its geometry is evaluated once at init. To
  move a rectangle over time, use `overlay` — its `x`/`y` *are* re-evaluated per
  frame. Also `drawbox h=0` means *full height*, not zero.
- **ffmpeg colour sources drop alpha.** `color=0xF2D027@0.8` produces `yuv420p`,
  which has no alpha plane, so the `@0.8` is silently discarded and you get a
  solid block. `format=yuva420p` must be inside the `-i` string; adding it later
  in the filter graph is too late.
- **Don't animate a CSS transform on a text layer.** A fifth of a pixel per
  frame makes Chromium re-rasterise the glyphs, and the type crawls. Move the
  background and the decoration; leave the type pixel-locked.
- **A slow `crop` offset judders** because crop takes an integer, and `zoompan` shakes on slow
  zooms too (it snaps its crop to whole pixels). For a smooth push use `perspective` with
  `eval=frame` — see `_zoom_vf` and `_render_footage_segment`.
- **Ask video models for times as `"MM:SS.s"` strings.** Asked for seconds, Gemini returns
  numbers that drift by minutes on long videos.
- **Black bars hide cuts.** Pixels that never change make two different shots correlate; `_cuts`
  ignores them. Detect cuts on the section itself, not on a frame grab.
- **yt-dlp without a JavaScript runtime** silently gets fewer formats. `youtube.ytdlp()` adds
  `--js-runtimes node` when Deno is missing — keep that.
- **macOS and Windows folder names are case-insensitive, Linux's are not.** `assets/music` and
  `assets/Music` are the same folder on a Mac and two folders on a server — keep names lower case.
- **Size text by measuring it,** not by counting characters. `_fit_one_line()`
  asks the real font. A 21-character line at 168px is 2124px wide — it wraps,
  and whatever you sized to hold one line now has two.
- **Stock footage is matched per ~15-second window, on purpose.** One search
  per minute let the first thing a minute mentioned fill all sixty seconds —
  a script that opened in a parked car showed nothing but cars. Keep
  `BROLL_WINDOW_S` small, and when a window's clip is spent let the slot
  take an atmospheric shot rather than the NEXT window's clip, or the whole
  video runs one window ahead of the voice.
- **Always give text I/O an explicit `encoding="utf-8"`.** Windows defaults to
  cp1252: a subtitle file written without it is read back by libass as UTF-8
  and every curly quote and dash turns to garbage, and one character outside
  cp1252 crashes the write. Every `read_text`, `write_text`, `open` and
  `subprocess.run(text=True)` in the engine already passes it — keep new code
  the same. Same for `Path.replace()` over `rename()`: rename refuses to
  overwrite on Windows.
- **Caching hides fixes.** Rendered mp4s, `scenes.json`, the Pexels ID registry
  and the browser all cache. Confirm a change against an extracted frame or a
  measured number, never by re-reading the code.

---

---

## Writing a style file

`look.accent` wants at least four colours: the engine reads the third and fourth
as "good" and "warn" in graphics scenes. Fewer than four now wraps round instead
of crashing, but give it four — the shipped channels carry five.

A story channel adds these to `look`: `character` (the cast, copied word for word
into every image prompt), `character_image` (a picture under `assets/`, sent as the
reference image on every still — see "The main character's picture"),
`placement: "story"` (every still sits on the words it was drawn for, in order, once),
`scene_prompt` (the channel's own storyboard prompt; tokens `[INSERT CHANNEL HERE]`,
`[INSERT COUNT HERE]`, `[INSERT SCRIPT HERE]`), `captions` (`size`, `upper`,
`outline`, `line_chars` — the caption is half the frame in a story video),
`zoom: "alternate"` (one still pushes in, the next pulls out), `dust: false` /
`vignette: false` for a clean drawn look, and `encode` (`{"preset": "slow", "tune":
"animation", "crf": 18}`) — a fast encoder makes flat drawn colour swim during a slow
zoom, so a drawn channel pays roughly three times the final encode time for a steady
picture. Every still zooms through `perspective`, not `zoompan`: zoompan snaps its crop
to whole pixels and visibly shook (see `_zoom_vf`). In `pacing`: `graphics: false` (never a
graphics scene — the mix is locked to pictures by `_lock_mix`) and `photo_every_s`
(one new still per that many seconds of narration). `pacing.mix` ships the channel's
own slider positions; the UI shows those the moment the channel is picked, and hides
the sliders altogether for a `graphics: false` channel.

`look.reference` points at an image under `assets/` — the card in the UI shows it,
so a channel looks like what it makes.
`look.sample` points at a video under `assets/` (the three shipped channels' samples are in `assets/brand/`) —
the card plays it muted instead of the picture, and **Watch sample** opens it with sound (`/sample/<style>`
in app.py, sent with range support). A 10-second clip or a full one-minute video both work. When a
buyer's own channel renders a video they like, offer to make it that channel's sample.

## Styles with their own visuals engine

`look.visuals` names the engine. "scenes" and "quotes" are built in; any other name is a
module in this folder — `"visuals": "vox"` runs `vox.py` for a whole video in paper collage. The hook is
`_visuals_plugin()` in make_video.py, and a module provides:

- `prepare(engine, script, job, style, force)` — runs beside the voiceover (pictures);
- `assemble(engine, job, mp3, srt, style, force, burn_subs)` — builds `video.mp4`;
- optionally `voiceover(engine, script, job, style, force) -> (mp3, srt)` — its own voice.

`engine` is make_video itself, handed in (an import would load a second copy when it runs
as `python make_video.py`). A pasted script is marked with `script.pasted`, so the length
check never swaps a 20-second script for a freshly written one.

## Scenes on the words: maps, real headlines, real photos, collage

These modules put their own scenes into a video exactly where the narration calls for them:
**MAPS** (`maps.py`) — a map whenever a place that matters is named — and **HEADLINES**
(`headlines.py`) — the real article behind a claim, on screen, the line highlighted.
`_with_scene_dlcs()` in make_video.py runs every module in `SCENE_DLCS` that is present,
right after the opening caption is placed, each handing the graphics timeline back with its
scenes added (maps first, then pages). A regular graphic in the way gives way; the opening
caption and a scene another DLC placed never do. Options has one switch per DLC
(`set_scene_dlcs`). A failure inside one is logged and never costs the video. `vox` runs only when Options → Vox style
scenes is ticked (`_FEATURES`).

`README-MAPS.md` and `README-HEADLINES.md` explain each — what Claude picks, the looks, the
per-channel `look.maps` / `look.headlines` settings. `python maps.py check` and
`python headlines.py check` report errors in seconds; open `preview/_maps_check.png` /
`preview/_headlines_check.png` to see the result.

**PHOTO FX** (`photofx.py`, third in `SCENE_DLCS`) adds real pictures, and has three switches in
Options. *Photo spotlight*: a real photo of a named person, place or moment — the camera pushes in
on the cut-out subject while the rest darkens and blurs (`spot_NN.mp4`). *Real objects*: real things
cut out of their photos, flying in over a blurred ground in their own colours with a drop shadow —
solo, a crown dropping onto the winner, a pair, a row (`objects_NN.mp4`). Both are scenes like maps
and pages, but `_mutes_captions()` keeps the captions and the dust on them: they are pictures, not
graphics. *Depth pop* is not a scene: `_render_astro_segments` asks `_depth_dlc()` which photo slots
get it (every third AI still of a person or a vehicle — `photofx.depth_subjects` has Claude look at the
stills first, because a lifted steering wheel, phone or plate looks wrong), and `_depth_segment()` renders
the subject lifted off with a keyline, slowly growing while the background pulls back (eased in and out,
never quicker than over 4 s) — falling back to the plain zoom whenever it cannot. Cutouts
come from WaveSpeed's background remover ($0.004, `WAVESPEED_API_KEY`) — or kie.ai's Recraft remover when WaveSpeed is below its reserve or `PHOTOFX_REMOVER=kie` (`removebg.py`, which also hosts reference pictures on kie.ai when WaveSpeed cannot), photos from Algrow's free
image search and Wikimedia Commons, and Claude chooses by eye — never by recognising a face; who is
in a photo comes from its caption. `README-PHOTO-FX.md` has the per-channel `look.photofx` settings;
`python photofx.py check` tests layers, ffmpeg and both scenes offline (`preview/_photofx_check.png`).

## The main character's picture

Algrow takes a reference image only as a public http(s) link — its docs say so, a
base64 data URI comes back HTTP 400, and there is no upload endpoint. So:

- `character_image_path(style)` — the picture picked in Options for this job
  (`set_character_image`, reset every run), else the channel's `look.character_image`.
- `host_image(path)` — uploads to catbox.moe, falling back to uguu.se (files expire
  after a few hours), and caches the link by the picture's sha256 in
  `assets/characters/hosted.json`; it re-uploads only when the link stops answering.
  catbox drops connections that use python-requests' default User-Agent, which is
  why every call sends `_HOST_HEADERS`.
- `_character_refs(style)` is resolved once per job in `generate_astrology_visuals`
  and passed as `ref_urls` to every still. gpt-image-2 was tested against
  nano-banana-2 with the same reference: it keeps the character and follows the
  composition (a window over the sink, a figure on a phone) better, at a third of the price.
- Options lists `assets/characters/*` (`GET /api/characters`). An upload
  (`POST /api/characters`) is saved as PNG, at most 1600 px, and
  `describe_character()` writes `<name>.txt` beside it with Claude vision and
  `prompts.CHARACTER_DESC_PROMPT` — the words the storyboard repeats in every prompt.

The storyboard (`_storyboard`) is drawn in parts of `STORY_CHUNK_FRAMES` frames
(36) so a long video never asks for more JSON than a model returns intact, and it is
never padded with repeats. `_build_story_plan` times each still with `_story_times`:
the subtitle words get times by sliding through their cue, the frames' words are
aligned against them with difflib, and each still starts where its words are spoken.
`story_times.json` beside `plan.json` lists every still's start and its narration, to
check the timing by eye.

## The mix and the description

`set_mix(ai, stock, gfx)` in make_video.py holds one job's visual mix as three
percentages. The UI no longer shows sliders: `_features_mix()` derives the mix from the Options
switches (a switched-off source gives its share to the rest; YouTube and stock share the footage share). `MIX_DEFAULT = (26, 42, 32)` is what the tool did before the sliders
existed, measured off a finished video, and while the mix equals the default every
derived value falls back to the channel's own settings — so a default run is
byte-for-byte the old behaviour. From the mix come: `_mix_stills_per_min()` (how many
AI stills to generate), `_mix_pexels_pool()` (how much stock to fetch),
`_mix_seg_dur()` and `_mix_every_min()` (how long a graphics scene runs and how often),
and `_mix_punch_every_s()` (the card/slit/highlight treatments). Both plan builders
then fill each slot with whichever kind is furthest behind its share, so the numbers
hold for the finished timeline, not just for the pools.

If someone asks for more than 60 % graphics: a scene is capped at ten seconds
(`MOTION_MAX_DUR`), so that is the ceiling the engine can honestly reach.

`generate_youtube_meta()` writes `youtube.txt` + `youtube.json` after the video.
Chapter timestamps are found by matching Claude's "first_line" against the SRT
(`_line_at`, then `_sentence_start` snaps to where the sentence begins) — never ask a
model for timestamps directly, it invents them. Source links are checked with
`_live_url()` and dropped when dead. The description and the chapter titles follow
the video's language, not the interface's.

## When they ask about rendering in the cloud (`farm/`)

Frontier can rent machines and render on them instead of the buyer's computer —
one pod per video, each switching itself off when done. It is part of the core;
the full guide is `README-RENDER-FARM.md` and the settings are in `.env.example`.

**Say the honest thing first.** People expect the cloud to be faster and it is
not: a rented core is slower than a recent laptop's, so one video takes *longer*
on a pod. What the farm buys is their computer back, five videos at once, and a
datacentre's connection for the footage downloads. Someone making one video a
week should stay local — tell them so.

**Warn them about the Claude bill.** At home the scripts and edit decisions go
through their signed-in Claude Code, free. A pod has no login, so they become
paid Anthropic API calls. `farm/` writes the script on their own machine for
exactly this reason (`write_script_here`), but the director, footage picking and
graphics still cost. Point them at their Anthropic dashboard after video one,
and at `CLAUDE_PROVIDER=kie` if it hurts.

**Setting it up**: a Cloudflare R2 bucket and its S3 token, a RunPod API key, and
`ANTHROPIC_API_KEY`. Then `python -m farm.farm check` — it round-trips the bucket
and tests the RunPod key and rents nothing. Never let them skip it.

How it fits together, if you are asked to change something:

| | |
|---|---|
| `farm/farm.py` | On their Mac: `check`, `queue`, `run`, `status`, `pull`, `kill`. `run_queue()` is shared with the app's buttons — change it once, both follow. |
| `farm/boot.py` | The first thing a pod runs, handed over base64 so no shell quoting can mangle it. Standard library only: nothing is installed yet. |
| `farm/provision.sh` | Installs ffmpeg, node, Chromium and the packages. Skips itself on a pod built from `farm/Dockerfile`. |
| `farm/runner.py` | The render itself, then upload, then switch off — the last one in a `finally`, plus a watchdog thread. |
| `farm/s3.py` | R2/S3, signed by hand so nobody has to install boto3. **Run `python tools/check_sigv4.py` if you touch it** — it checks the signing against botocore's, on keys with spaces and Czech characters, which is what breaks first. |
| `farm/state.py` | `youtube_used.json` across pods: master in the bucket, each pod writes only its own additions, the Mac folds them in. |

Traps, all real:

- **The pod has no Claude Code.** `farm/config.py POD_FORCED` pins
  `CLAUDE_PROVIDER=anthropic`; without it every call waits to discover the CLI is
  missing before falling back.
- **Slugs must match the engine exactly.** The Mac names the bucket key, the pod
  names the folder. `farm/spec.py slugify` uses `make_video.slugify` and copies it
  faithfully — digest included — when it cannot import it. Drift means the Mac
  fetches a video that is filed under another name.
- **Never let the code bundle carry `.env`.** `BUNDLE_SKIP` in `farm/farm.py` keeps
  it, and the used-footage files, out. Keys reach a pod through RunPod's encrypted
  environment, never the bucket.
- **Bring-your-own voiceover cannot work on a pod** — it names a local file.
  `spec.problems()` refuses it rather than failing an hour in.

---

## When they ask about updates

New versions ship at **https://whop.com/frontierhq/frontier-access/** — that is
the only place. They arrive as an update pack: a folder holding `update.json`,
a `files/` tree and its own copy of `update.py`.

Install one by running it FROM the pack, pointed at this folder:

    python <pack>/update.py <pack> --into <this folder>

Never copy the files over by hand. The pack knows what each file looked like in
the version they are on, so `update.py` can tell "they never touched this,
replace it" from "they edited this, leave it alone". An edited file is never
overwritten: the new version lands beside it as `<name>.new` and is reported as
a conflict. Everything replaced is copied into `.frontier/backup/<timestamp>/`
first, and `.frontier/version` records what they are on.

When it reports conflicts, that is the job to do next: open each `.new` beside
the user's file and merge THEIR changes with the new ones — their customisation
is the reason they bought this, so it wins any tie. Delete the `.new` file once
it is merged.

`.env`, `styles/` and `output/` belong to the user and are never in a pack, so
their keys, their channels and their videos are untouched either way.

---

---

## Tone

Answer in the user's language (English unless they write in another). Be brief. When they ask for
a change, make it and show them the result — don't explain the architecture unless they ask. Never
show or repeat API keys.

### LOOK KITS — eight more complete styles (`kits.py`, `frames.py`, `legend.py`; 2026-09-20, reworked 2026-09-21)

Eight channel styles that look nothing like each other, each a whole design system: `dossier` (true crime — typed
alerts, red crosshairs, gold serif names, typewriter captions at the bottom, footage as EVIDENCE-stamped prints on a
chart under a torch beam), `kinetic` (essays — pop captions in Kode Mono, clips pinned to a chalkboard with the line
in chalk, chalk icons that draw themselves (`doodle`), white line-drawn stills that sketch on (`look.reveal:
"sketch"`), phone cards, comments), `atlas` (cartoon history — TIME MACHINE bar, flipchart, wristwatch, paint wipes,
a sunburst title card, every other still set in motion by Seedance via `animate.py` (`look.animate`), comic
captions), `deep` (military mysteries — stencil dates, sonar, cutaways, the map room, footage inside a teal monitor
with black bars cropped away, small caps captions), `news` (style file `styles/news.json`, kit id `frontline` — heat maps, arrows, boxed labels,
broadcast lower thirds, tickers, a dated timeline, footage in a navy news band), `legend` (the story in the star's
OWN cloned voice: a real interview clip opens the film with its own subtitles, `legend.py` clones it on Algrow and the
script continues in the first person), `hustle` (make-money — one 2D character in every drawn picture, footage on a
blue grid stage, real 3D props, real objects on a cork board, real platform pages as headlines, big pop captions)
and `tape` (NOT shipped — `.shipignore` keeps `styles/tape.json` and `assets/kits/tape.js` here; a dark studio: clips in a player window with the channel plate, subscriber counters
with a curve, posts as cards, upload timelines, quotes, versus, pill captions with the spoken word in red).

How a kit style is wired: `look.graphics: "kit"` + `look.kit: "<name>"` routes the graphics step to `kits.py`
(scene JS in `assets/kits/<kit>.js`, fonts embedded from `assets/fonts/`, generated grounds attached as data URIs by
`_with_props`); the director offers that kit's scene types (`director._graphic_tool`); `look.captions.mode` picks a
caption mode (`cluster | typewriter | shout | pop | comic | pill | stack`, or `captions.off`) in `_build_burn_ass_kit`
(`stack` = kinetic typography: one event per spoken word holding the whole block, words to come transparent);
`look.labels` (a dict) skins the director's text labels per kit in `_overlay_ass_kit` (corner, fonts, box/rule,
entry) so no two styles share a corner; `look.cinema.frame` picks the footage treatment in `frames.py` (`blurfill |
print | page | stage | crt | monitor | news | paper | player | board`, every `frame_every`-th shot; `cinema.ground`
swaps the generated ground under `stage`); grounds are drawn once by gpt-image-2 into `assets/kits/frames/gen_*.jpg`
(chart, stage, monitor, wall, cork, grid, sketchboard, newsdesk, studio, titlewall); `look.photofx.ground` lays real
objects on one of them; `look.avatar` opens every video with a preset presenter (`avatar.py`, WaveSpeed InfiniteTalk
when kie is dry); `look.style_image` rides along as a STYLE reference on every still; `look.footage_taste` steers the
stock searches; `captions.mute_under_frames` keeps captions off the news band (cinema writes `frame_mutes.json`);
`_denoise_voice` cleans a hissy read (floor above -55 dBFS) with anlmdn; `look.maps.skin` may be `chart | twotone | heat | cartoon` (maps.py SKINS + `deco` in
map.js); new sounds in `sfx.py` (`typekey`, `boing`, `ping`, `sting`, `cash`, `pop`, `hum`).

Traps: a JPEG ground is full-range — `frames.GROUND_IN` converts it before anything is laid on it, or the final
subtitles pass dies with "Invalid argument"; drawtext text goes through `frames._dt()`; an ASS time is `h:mm:ss.cc`
(`frames._ass_t`); a scene whose `frame(0)` throws must still set `__ready` (kits.py catches it); replacing a function
by slicing between two `def`s deletes everything between them — `grep ^def` after; kit fonts are loaded before
`build()` (a lazily loaded face makes `fit()` measure in the fallback font); a flex container eats the spaces
between text runs (type into one inner span); `_clip_is_black` drops stock clips that are black throughout.

Check them: `python kits.py check` (one frame of every scene type), `python kits.py preview <kit>` (mp4 + png per
scene in `preview/kits/`), `python frames.py <kind> <clip.mp4>`, `python maps.py show "Ukraine" --skin heat`.
