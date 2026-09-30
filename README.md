# FRONTIER 5.1

A faceless-video studio that runs on your own computer. You type a title — or paste your own
script — and Frontier writes the narration, records the voice, finds real footage, draws the
graphics, animates maps on a real satellite floor, pins real newspaper pages, adds sound design,
can open the video with an AI presenter, cuts it all together and hands you a finished 1080p video
with a thumbnail and a YouTube description.

Nothing is uploaded anywhere except the API calls it makes for you.

*Made by [Primal Robin](https://x.com/primalrobin).*

---

## What's new in Frontier 5.1

- **NEW: 3D — history rebuilt in 3D.** A documentary rebuilt almost entirely in real-time 3D on your own graphics
  card: drone and FPV shots, close-up details, ships, oceans, planets, towns and crowds — directed, checked and
  repaired by Claude before it renders. Sample: `samples/3d.mp4`.
- **NEW: FOLIO — the illustrated explainer.** A moving picture book: every shot is an illustration Claude draws in
  code — the same characters all film, places and years in quiet serif labels on the spoken word, cream-paper
  diagrams for every "how", camera-driven transitions and a score written to the edit. No footage, no stock, no AI
  pictures — [README-FOLIO.md](README-FOLIO.md), sample `samples/folio.mp4`.
- **Three new channels.** **HORIZON** — data documentaries: real news footage, and between it the numbers drawn
  from World Bank and UN data (a line chart the camera follows as it is drawn, population pyramids turning over to
  2100, generations shrinking row by row, real documents with their translation, quotes typed as they are read) —
  [README-HORIZON.md](README-HORIZON.md). **PULSE** — AI news with a recurring presenter, official company logos and
  benchmark graphics — [README-PULSE.md](README-PULSE.md). **ALMANAC** — the history of people and things: archive
  film printed in three inks, collector's cards, press proofs — [README-ALMANAC.md](README-ALMANAC.md).
- **The graphics are fact-checked too**: the words a look kit prints on screen are checked like the script, before
  they are rendered.
- **Your own Epidemic Sound account, per video** (`EPIDEMIC_API_KEY`, optional): a track per chapter chosen by its
  mood and cut to its exact length, and a fresh effects kit per channel.
- The presenter can appear up to 24 times; smooth newspaper moves for modern channels; the first chapter's pause no
  longer splits the video's first words; a clear message when YouTube refuses downloads.

## What's new in Frontier 5

- **AI presenter.** A real-looking person opens the video and speaks your first lines straight to
  camera, then it cuts to the pictures — and the same person turns up in the AI pictures afterwards.
  Nineteen presenters ship (nine women, ten men, from a kitchen to a trading floor, a clinic, a gym and a
  stream setup), you pick one, how many seconds (1–15) and how many times it appears (1–6): after the
  intro it can come back during the video, and while it talks nothing else is on screen. Two new channels
  are built around it: **AI Presenter** and **Modern Homes**. About $0.30 per 8-second appearance.
- **The cloud farm.** Rent one machine per video, render five overnight, get your computer back.
  About $0.10–0.30 of machine time per video. A step-by-step setup is [below](#cloud-rendering--the-walkthrough).
- **Footage watching for free.** Frontier now asks the Google Gemini free tier first, so finding real
  YouTube footage costs nothing for about a video a day — then the cheapest backup takes over.
  The Internet Archive is a second free footage source (public-domain and CC films, credited in the
  description).
- **Seven look kits** — complete channel designs: **DOSSIER** (true crime), **KINETIC** (essays with
  kinetic captions), **ATLAS** (cartoon history), **DEEP** (military mysteries), **NEWS**
  (geopolitics, with a presenter at a newsroom desk), **LEGEND** (a star's story in their own cloned
  voice) and **HUSTLE** (make-money). [README-STYLES.md](README-STYLES.md) has the table.
- **Maps on a real satellite floor.** The ground is a photograph of the Earth (Natural Earth,
  public domain), the table tilts in 3D, borders are white hairlines, the country the story is
  about is washed in your channel's colour, names sit on black chips — and a missile launch or a
  flight is drawn as an **arc that climbs off the map with a red arrow on its head**, over a dashed
  ground track. Whole-globe shots fly over the pole with no seams.
- **A fact check before the voice.** The finished script is cut into parts and every part is checked at
  the same time by Claude with web search — dates, numbers, names, places, quotes, "the first" and "the only" —
  and the fixes go in before a word is recorded. A 35-minute script takes about three minutes; the report is
  `factcheck.json` in the video's folder, the original `script.before-factcheck.txt`. A channel can switch it
  off with `"look": {"factcheck": false}`.
- **Real clips with their own sound.** Where the script marks a moment (`[[clip: …]]`), Frontier finds it on
  YouTube — a TV announcement, a speech, an interview — lets a video model point at the exact seconds where the
  person is heard with nobody talking over them, crops away other channels' subtitles and black bars, and
  quotes what is said under the picture in your channel's language. A clip where nobody speaks (an anthem,
  applause) gets no quote, so no one ever has words put in their mouth.
- **Newspapers in the opening**, **name labels that follow the person's face** smoothly, **music that
  changes from video to video** by itself, kinetic captions, style-reference drawings, stills that
  move, automatic voice clean-up, and one finished sample video per channel in `samples/`.
- **Two studios in the app.** FRONTIER PRODUCTION holds every documentary and edited channel; AI AVATAR
  holds the presenter channels (AI Presenter, NEWS, Modern Homes) with the whole presenter library on one
  screen. Channel cards are smaller, each plays its sample, and the picker folds away once you've chosen.
- **You see what Claude cost.** Every render ends with a line saying how many Claude calls it made.

---

## Start here — the two-minute version

1. **Open this folder in Claude Code and say hello.** Claude reads `CLAUDE.md`, explains everything
   below in plain words, installs what's missing, and asks you for your API keys one at a time.
2. **Describe your channel** — the niche, the tone, a few videos you love, colours you like.
   Claude builds you your own style from the one closest to it, and shows you samples before you
   spend anything.
3. **Run `python app.py`**, choose a studio — **FRONTIER PRODUCTION** (documentaries and edited videos) or
   **AI AVATAR** (a presenter opens every video) — pick a channel, type a title, press **Create video**.

**Stuck on anything? Ask Claude Code first.** Open this folder in Claude Code and describe what happened —
it knows the whole tool, reads the log and fixes technical problems for you.

You don't need to read the rest of this file. It's here so you know what's in the box.

---

## API providers — what to use

You do **not** need every service. This is the setup we recommend, cheapest first:

| For | Use | Why | Get it |
|---|---|---|---|
| **Watching footage** *(the default)* | **Google Gemini API — free tier** | Finds your YouTube footage for **free**, up to 8 hours of watched video a day — about one new video a day. This is what keeps a video at a couple of dollars. | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) → `GEMINI_API_KEY` |
| **Backup when the free tier runs out** | **OpenLux** | The cheapest way to keep watching: the same Gemini models at a fraction of Google's price. | [openlux.ai](https://openlux.ai) → `OPENLUX_API_KEY` |
| **Pictures, voices, subtitles** | **Algrow** | gpt-image-2 pictures for about a cent each (top-up credits), ElevenLabs voices, subtitles. Also one of the best **niche-research tools** for YouTube — outlier videos, channel research, finding a niche before you spend a month on it. | [go.algrow.online/tool](https://go.algrow.online/tool)* → `ALGROW_API_KEY` |
| **The AI presenter** | **WaveSpeed** + **kie.ai** | WaveSpeed hosts the presenter's portrait and audio and runs the InfiniteTalk presenters; kie.ai renders the default one (Kling Avatar 2.0). Add both. WaveSpeed also cuts out real photos and objects. | [wavespeed.ai](https://wavespeed.ai) → `WAVESPEED_API_KEY` · [kie.ai](https://kie.ai) → `KIE_API_KEY` |
| **Scripts, editing, the fact check** | **Claude Code** | The script, the edit decisions and the fact check go through the Claude Code you're signed into — no extra key. | [claude.com/claude-code](https://claude.com/claude-code) |

\* *The Algrow link is an affiliate link. It costs you nothing extra and supports Frontier.*

**Already have keys somewhere else? Use them.** Frontier isn't tied to any of these. Send Claude Code
the link to your provider's API page (the documentation page with its endpoints) and say *"wire this
in for pictures"* — or voice, or footage watching. Claude reads it and adds it.

### Every provider Frontier knows

| Provider | What Frontier uses it for | What it costs | `.env` key |
|---|---|---|---|
| **Google Gemini API** | watching footage (first choice) | free up to 8 h of YouTube a day, then cents | `GEMINI_API_KEY` |
| **OpenLux** | watching footage (backup) — a Gemini relay | a fraction of Google's price | `OPENLUX_API_KEY` |
| **Algrow** | pictures (gpt-image-2), voice (ElevenLabs), subtitles, niche research; watching footage as a last resort | top-up credits $0.031–0.033; a picture ≈ $0.011 | `ALGROW_API_KEY` |
| **WaveSpeed** | AI presenter (hosting, InfiniteTalk), photo spotlight, real objects, depth pop, collage cutouts; backup pictures (Seedream) and voice | pay as you go from a prepaid balance | `WAVESPEED_API_KEY` |
| **kie.ai** | AI presenter (Kling Avatar 2.0), backup pictures, background remover, a Claude relay | credits | `KIE_API_KEY` |
| **ai33** | voice, if you already use it | per character | `AI33_API_KEY` |
| **Claude Code** | scripts, direction, footage picking, the fact check, descriptions | your Claude plan | — |
| **Anthropic API** | the same as Claude Code — needed on the cloud farm, optional at home | Sonnet 5: $2 in / $10 out per million tokens | `ANTHROPIC_API_KEY` |
| **Pexels** | stock footage | free | `PEXELS_API_KEY` |
| **YouTube** (yt-dlp) | real footage | free | — |
| **Internet Archive** | free public-domain and CC footage | free | — |
| **RunPod** + **Cloudflare R2** | the cloud farm | about $0.17 an hour per machine; R2 free tier | `RUNPOD_API_KEY`, `FARM_BUCKET_*` |

If a service is missing, everything that doesn't need it still works — Options shows the feature in
red with the exact key that would unlock it.

---

## The channels that come with it

| Channel | What it looks like | Per minute, with the Gemini free tier |
|---|---|---|
| **Documentary** *(the default)* | Streaming-documentary look: real YouTube footage of the real events, maps, real newspaper pages, real photos and objects, paper-collage scenes, quiet premium graphics, sound design. | about $0.08 |
| **3D** | History rebuilt in real-time 3D on your graphics card: drone and FPV shots, ships, oceans, planets, crowds — directed and checked by Claude. | about $0.05 (the voice) + Claude on your plan |
| **FOLIO** | A moving picture book: every shot an illustration Claude draws in code, the same characters all film, paper diagrams, a written score. | about $0.05 (the voice) + Claude on your plan |
| **Sports documentary** (COURTSIDE) | Archive-film sports stories: VHS texture, Kodak strips, film maps, old newspapers, interview soundbites. | about $0.04 |
| **DOSSIER · DEEP · LEGEND** | Look kits for true crime, military mysteries, and a star's story in their own cloned voice. | about $0.03–0.04 |
| **KINETIC · ATLAS · HUSTLE** | Look kits for essays, cartoon history and make-money videos — more drawn pictures. | about $0.10–0.15 (ATLAS + about $0.50 once for four animated clips) |
| **AI Presenter** · **Modern Homes** · **NEWS** | An AI presenter opens the video, then pictures (or, in NEWS, footage and maps) carry it. | about $0.05–0.11 + about $0.15–0.30 per presenter appearance |
| **HORIZON** | Data documentaries: real news footage full frame, and the numbers drawn from World Bank and UN data — charts, population pyramids, documents, quotes. | about $0.05 |
| **ALMANAC** | The history of people and things: archive film printed in three inks, collector's cards, press proofs. | about $0.05 |
| **PULSE** | AI news: a recurring presenter, official logos, benchmark bars, real launch posts. | about $0.25 + about $0.23 per presenter appearance |
| **2D Stories** | A POV money story in flat 2D pictures with one consistent main character. | about $0.15 |
| **Carl Jung — dark psychology** | Dark psychology narration over stock footage and AI images. | about $0.05 |

Those are the recommended setup's prices: footage watched free on Gemini, pictures on Algrow top-up credits.
A 30-minute documentary comes to about $1–2 plus voice credits (a 37-minute one measured about $1.30 in
pictures). **Watching footage on paid credits instead adds about $0.25 a minute** — that is where the older
"$0.50 a minute" for a documentary came from.

A style is one file in `styles/`. Your own channels live there too — Claude writes them for you.

**See before you spend.** One finished video per channel sits in `samples/` — open them before
installing anything. Inside the app each channel card plays its sample, and **Watch sample** shows it
big with sound.

**A channel adapts to the title.** Documentary has variants in `styles/variants/` that it switches to by itself when a title calls for them: a video-game story gets the gaming explainer, a grooming or style how-to gets the how-to look. The log says which look was chosen. Add your own variant by copying one and changing `match` — the sentence that describes the titles it is for.

Every channel writes in its own voice, and Frontier adds the same retention craft on top of its prompts: a hook that confirms the video in the first seconds, opens one specific question and stacks two or three hard specifics; a chain of payoffs that always opens the next question; the title's big payoff foreshadowed and then delivered; no invented facts. Set `"script_craft": "story"`, `"teaching"` or `"off"` in the style file. A script you paste yourself is never rewritten.

**How a documentary is edited.** One director reads your narration and decides, sentence by sentence,
what the viewer sees on top of the real footage. The opening is the hook and gets the most: newspaper
pages on the first reported facts, a map of the first place, a real photo of the first person,
labels for every name and number. After that the video breathes — real footage carries it, with maps
whenever the story moves, graphics on the numbers that matter and real photos often. Then a second
pass checks every real shot against the words over it and swaps the misleading ones.

---

## Options — everything a video can be built from

When you pick a style, **Options** shows every feature it offers, all ticked. Untick anything you
don't want in *this* video. A feature whose API key is missing is shown **in red** with the exact
key to add — so you see it before you press Create, not halfway through a render.

Every switch shows roughly what it costs per minute with the services in your `.env`, and next to
**Length** you see the estimate for this video — how long it takes to render and what it costs.

| Switch | What it does | Needs |
|---|---|---|
| **YouTube footage** | Real footage of the real events, people and places. Claude writes a search for every ~30 seconds of narration, a video model watches the results and logs every shot, Claude picks the shots that show what's being said, and only those seconds are downloaded — trimmed, cropped clear of logos and black bars. Official uploads come first. Long videos are only watched where they talk about your story. | yt-dlp + **one** of: Gemini (free) · OpenLux · Algrow · WaveSpeed · kie.ai |
| **Stock footage** | Pexels b-roll searched from the narration. | Pexels (free) |
| **AI images** | Pictures drawn for the exact words they sit on. | Algrow · WaveSpeed · kie.ai |
| &nbsp;&nbsp;↳ **Depth pop** | A person or a car in a picture slowly lifts off it while the background pulls back. | WaveSpeed · kie.ai |
| **Motion graphics** | Animated scenes for the numbers, dates, names and turning points — plus text labels on the footage, and name labels that follow a person's face. | nothing extra |
| **Vox style scenes** | A few moments told as hand-cut paper collage — real people as halftone cutouts, pins, red string, typewriter labels. | WaveSpeed · kie.ai |
| **Map animations** | Whenever the narrator names a place that matters: a real satellite floor tilted in 3D (or your channel's own map look), the place lit up, pins, routes — and missiles or flights as arcs climbing off the map with an arrow. Timed to the word. | nothing extra |
| **Photo spotlight** | A real photo of who or what is being named; the rest darkens as the camera pushes in. | WaveSpeed · kie.ai |
| **Real objects** | The things the narrator names, cut out of real photos and flying in. | WaveSpeed · kie.ai |
| **Newspaper animations** | The real article behind a claim — or the printed page of the day for older stories — the line highlighted. | nothing extra |
| **Sound design** | Whooshes, hits, risers, taps — all synthesised — plus your own music bed, dipping under the voice and changing from video to video. | nothing extra |
| **AI presenter in the intro** | A real-looking person opens the video and speaks your first lines to camera. Pick the face (filtered to your narrator's sex), 1–15 seconds, and how many times it appears (1–6). Later appearances are spread through the video, each from the start of a sentence to its end, at least 10 seconds apart and never in the last 20 seconds — a short video fits fewer, and only the ones that fit are made and paid for. While the presenter talks the screen is only the presenter. About $0.04 a second of presenter — each appearance is billed like the intro. | WaveSpeed **and** kie.ai |

Also in Options:

- **Use your own script** *(optional)* — paste a finished script and Frontier narrates exactly that.
- **Extra instructions** *(optional)* — anything for this one video: "focus on the engineers",
  "no graphics in the first minute", "UK spelling". Paste YouTube links too — a video on the same
  story, or a whole channel: the script builds on their facts, in its own words.
- **Output** — burnt-in subtitles, thumbnails, a YouTube description with chapters and sources.

**Your title matters most.** A specific title ("New Coke: The 79-Day Disaster That Saved Coca-Cola")
makes a far better video than a vague one ("Coca-Cola history").

---

## Cloud rendering — the walkthrough

Rendering pins every core on your computer for hours. The farm rents one Linux machine per video:
each renders, uploads the finished video to your own storage and **switches itself off**. Queue five
titles in the evening, collect five videos in the morning.

**Be clear about what it buys you.** It will not make one video faster — a rented core is slower
than a modern laptop's. It buys your computer back, five videos at once, and a datacentre's
connection for downloading footage.

**What it costs:** about **$0.10–0.30 of machine time per video**, your usual API calls unchanged,
and one new bill: a rented machine isn't signed into your Claude Code, so the smaller Claude calls
made there (picking shots, building labels) become paid Anthropic API calls. The big ones — the
script, the voice, the stills and the edit plan — are made on **your** computer before anything is
rented, so you read the script before paying to have it filmed.

Setup takes about fifteen minutes and rents nothing:

**1. Cloudflare R2 — where the finished videos land** (free tier)
1. Make a free account at [dash.cloudflare.com](https://dash.cloudflare.com).
2. Left menu → **R2 Object Storage** → **Create bucket** → name it `frontier-farm`, location **Automatic**.
3. On the R2 page → **Account details** → **API Tokens** → **Manage** → **Create API token** →
   **Account API token**, permission **Object Read & Write**, limited to `frontier-farm`.
4. It shows an **Access Key ID**, a **Secret Access Key** and an endpoint
   `https://<account id>.r2.cloudflarestorage.com`. **The secret is shown once** — copy all three now.

**2. RunPod — the machines**
1. Make an account at [runpod.io](https://runpod.io).
2. **Billing** → add **$10**. At a few cents to thirty cents a video it lasts a long time.
3. **Settings** → **API Keys** → **Create API Key**, permission **All**. Copy it — RunPod won't show it again.

**3. A Claude key for the machine**
[console.anthropic.com](https://console.anthropic.com) → **API Keys** → create one → put a few
dollars on it.

**4. Put them in `.env`**
```
RUNPOD_API_KEY=the key from runpod
FARM_BUCKET_ENDPOINT=https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com
FARM_BUCKET=frontier-farm
FARM_BUCKET_KEY_ID=the access key id from r2
FARM_BUCKET_SECRET=the secret access key from r2
ANTHROPIC_API_KEY=the key from anthropic
```
Your other keys (Gemini, Algrow, WaveSpeed, kie.ai) travel with each job, so the machine uses the
same providers you do at home. The AI presenter works on the farm too, with the same two keys.

**5. Check before you spend anything**
```bash
python -m farm.farm check
```
It writes a test file to your bucket, reads it back, deletes it, and asks RunPod whether your key
works. **It rents nothing.** Don't go further until every line is a tick.

**Using it.** In the app, tick **CLOUD RENDER** under the Create button (it stays greyed out, listing
what's missing, until the keys are in). Pressing Create now does the waiting half on your computer —
script, voice, thumbnail, the edit plan — and queues the job. Queue as many as you like, read the
scripts, then press **Start the farm**. **Finished on the farm** lists the finished videos with a
Download button. From the command line:

```bash
python -m farm.farm queue "New Coke: The 79-Day Disaster That Saved Coca-Cola" --style documentary
python -m farm.farm run --pods 5
python -m farm.farm status               # what every machine is doing
python -m farm.farm pull                 # into output/<channel>/, same as a local render
python -m farm.farm kill                 # everything off, right now
```

**Your money is protected four ways:** a pod switches itself off when its render ends; a watchdog
inside it kills it at `FARM_MAX_MINUTES` (240); your computer watches too and ends anything that
overruns; and `farm.farm kill` switches everything off with one command. `FARM_BUDGET_USD` (10) stops
a batch that spends more than you meant, `FARM_MAX_PODS` (5) caps how many run at once.

**[README-RENDER-FARM.md](README-RENDER-FARM.md)** has every setting, how to make pods start faster,
and what to do when a card isn't available.

---

## Install

You need **Python 3.10+** ([python.org](https://python.org)), **ffmpeg** (Mac: `brew install ffmpeg` ·
Windows: `winget install Gyan.FFmpeg`) and **Node.js** ([nodejs.org](https://nodejs.org) — YouTube needs a
JavaScript runtime to hand over the good formats). Then:

```bash
pip install -r requirements.txt
playwright install chromium
cp .env.example .env
```

Open `.env` and paste in the keys you have — start with `GEMINI_API_KEY`. **On Windows** it's the same
in PowerShell (`copy` instead of `cp`; use `py` if `python` isn't found). After installing ffmpeg or
Node, open a **new** terminal so it's found.

## Run

```bash
python app.py
```

Your browser opens. Pick a style, type a title, choose a length, look through Options, press
**Create video**. While it renders, the page shows every stage as it happens — script, voice,
footage, edit, scenes, graphics, render, sound, final — and **Details** opens the full log.
A 10-minute documentary takes roughly 40–60 minutes on a laptop.

---

## Make it yours

You own the code. Everything is changeable by asking Claude Code in plain words:

- *"Make a new style for my true-crime channel, based on DOSSIER, red accent."*
- *"Use a different serif for the graphics and make the numbers bigger."*
- *"Add a graphic that shows two people side by side with their dates."*
- *"Captions off by default, and the music quieter."*
- *"Add my own presenter — a woman in her forties in a navy blazer."*

**Write in someone else's voice.** Paste two or three scripts (or transcripts) from channels you admire into
Claude Code and say *"write our script prompt in this voice"* — Claude reads how they open, how they turn, how they
end, and rewrites your style's `prompts.outline` / `prompts.script` to match. Your own scripts work the same way:
paste one into Options → *Your own script* for a single video, or hand Claude ten of them to learn your voice for
every video after.

**Your own presenter.** Drop a portrait PNG into `assets/avatars/` with an entry in `avatars.json`
(`id`, `gender`, `niches`, `file`, `persona`) — or ask Claude to draw one. The persona text matters: it's
pasted into the picture prompts so the same person appears in the stills. The presenter speaks your
channel's own voiceover; if you switch the voice to the other sex, change `voice.gender` too.

The finished `video.mp4` has the presenter already in it; `video_plain.mp4` beside it is the same film
without. Turning the presenter off, picking another face or changing how many times it appears, on a
re-render of the same title, swaps only the presenter's stretches — the rest of the video is not assembled
again. If the presenter service fails on the intro, the video still ships, just without the presenter; a
later appearance that fails costs only that appearance.

Claude changes the files, renders a preview and **looks at it** before telling you it's done.

See things before you spend anything:

```bash
python docgfx.py preview          # every documentary graphic -> preview/docgfx/
python sfx.py preview             # every sound effect -> preview/sfx/
python youtube.py search "Apollo 11 launch footage"
python maps.py demo               # a map animation
python preview.py --all           # every classic motion graphic in your style's look
python check_templates.py         # did anything break?
python check_video.py <slug>      # a finished video: pacing, repetition, language, audio
```

### Map looks

A channel picks its map look in its style file: `"maps": {"skin": "terrain"}` is the satellite
war-room floor (tilted, white borders, arrows for flights), `midnight` a glowing dark globe, `paper`
an old atlas, `clean` a news explainer, `film` an archive-documentary look. `every_s` sets how often a
map may appear. Maps a director places are kept through the footage pass; one per 40 seconds is
normal for a story that moves around the world.

### Music

Frontier never ships music. Drop tracks you have the rights to into `assets/music/<style>/`
or straight into `assets/music/`. With **Sound design** on, one plays under the whole video, levelled
against the narration and mastered to YouTube's loudness (-14 LUFS). Name several tracks in
`look.sound.track` (`"track a | track b | track c"`) and `look.sound.body_tracks`, and Frontier
**changes the music from video to video** — each new video gets the track that channel has gone
without longest, so two videos in a row never sound the same. Levels live in `look.sound`:
`music_rel_db`, `duck_db`, `sfx_db`, and `intro_s` / `intro_db` / `after_db` to let the opening carry
the music.

### "Sign in to confirm you're not a bot"

A long documentary asks YouTube for hundreds of things in an hour, and a burst like that can get
the run blocked. Put these in `.env`, the first two on their own first:

```
YT_SLEEP=2                          # seconds between requests
YT_WORKERS=2                        # yt-dlp runs at once (normally 6 to 8)
YTDLP_COOKIES_FROM_BROWSER=chrome   # sign in as yourself: chrome, brave, edge, firefox, safari
```

Use a spare Google account for the cookies, never the one your channel lives on. It is slower, not
weaker. `look.youtube.sources: ["youtube", "archive"]` lets the Internet Archive answer whatever it
can — its films are free, and it asks nothing of you. A run that has already watched its videos keeps
them in `<job>/youtube/catalog`, so starting the same video again costs almost no requests.

### Footage you didn't film

YouTube footage belongs to whoever filmed it. Documentary channels use short excerpts for
commentary and transformation, but fair use depends on your country and how you use it, and a
rights holder can still claim a video. You decide what you publish — check anything that matters.

---

## Cost

| Channel | With the Gemini free tier *(recommended)* | Footage watched on paid credits |
|---|---|---|
| Documentary | about $0.08 a minute | about $0.50 a minute |
| 3D | about $0.05 a minute (the voice) + Claude's directing on your plan | the same |
| FOLIO | about $0.05 a minute (the voice) + Claude's drawing on your plan — see [README-FOLIO.md](README-FOLIO.md) | the same — no footage to watch |
| Sports documentary | about $0.04 a minute | about $0.60 a minute |
| DOSSIER · DEEP · LEGEND | about $0.03–0.04 a minute | about $0.30 a minute |
| NEWS | about $0.05 a minute + about $0.15 per presenter appearance | about $0.30 a minute |
| KINETIC · HUSTLE | about $0.10–0.15 a minute | add about $0.25 a minute |
| ATLAS | about $0.15 a minute + about $0.50 once for four animated clips | add about $0.25 a minute |
| AI Presenter / Modern Homes | about $0.09–0.11 a minute + about $0.30 for each 8-second appearance of the presenter | the same — no footage to watch |
| HORIZON · ALMANAC | about $0.05 a minute | about $0.30–0.60 a minute |
| PULSE | about $0.25 a minute + about $0.23 per presenter appearance | add about $0.25 a minute |
| 2D Stories | about $0.15 a minute | the same |
| Carl Jung — dark psychology | about $0.05 a minute | the same |

**With the Gemini free tier, watching footage costs nothing** — a 30-minute documentary comes to about
**$1–2 plus voice credits** (measured: a 37-minute documentary, about $1.30 in pictures plus voice credits).
Claude Code usage comes from your own Claude plan; every render ends with a line saying how many calls it made.

### Buy Algrow credits as top-ups, not out of the plan

Algrow sells the same credit two ways:

| | Price per credit | A gpt-image-2 picture (0.35 credits) |
|---|---|---|
| **Top-up** — Boost 150/$4.99, Creator 405/$12.99, **Studio 1000/$31.49** | **$0.031–$0.033** | **about $0.011** |
| Plan allowance — Professional $45 for 300 credits | $0.15 | about $0.053 |

Top-up credits are about **4.5× cheaper** than plan credits and, per Algrow's own page, never expire.

### Footage watching — who is asked, in what order

A video model *watches* candidate videos to find the right seconds, and that is where the money
would go. Frontier tries the watchers **cheapest first** and only falls through when a key is
missing or a quota runs out:

| Order | Watcher | What it costs | Key |
|---|---|---|---|
| 1 | **Google Gemini API** *(recommended)* | **free** up to 8 hours of YouTube a day (≈ one new video a day), then cents | `GEMINI_API_KEY` |
| 2 | **OpenLux** | a fraction of Google's price — the cheapest backup | `OPENLUX_API_KEY` |
| 3 | Algrow | about 1 credit per 4 minutes watched — the dearest option here | `ALGROW_API_KEY` |
| 4 | WaveSpeed / kie.ai | Gemini through their gateways | `WAVESPEED_API_KEY` / `KIE_API_KEY` |

Google never charges a free-tier key: when the day's quota is used up it simply refuses, and Frontier
moves on to the next watcher. Free-tier daily limits reset at midnight Pacific time. A second video
on the same story in another language reuses the first one's footage and watches almost nothing.

**Running low on WaveSpeed?** Frontier keeps a reserve (`WAVESPEED_RESERVE_USD`, default $0.50):
below it, collage and object pictures are drawn on Algrow instead, cutouts are made by kie.ai's
background remover when there is a `KIE_API_KEY`, and nothing stops halfway.

---

## Files

```
app.py            the local web UI
make_video.py     the pipeline
director.py       the editor: which scene, label or graphic shows each sentence
styles/           one file per style — yours live here too
features.py       the Options switches and the keys each needs
youtube.py        YouTube footage: search, shot logging, cutting
archiveorg.py     free Internet Archive footage
docgfx.py         the documentary graphics
cinema.py         chapter cards, year cards, name labels that follow a face, footage treatments
maps.py           map animations          (README-MAPS.md)
headlines.py      newspaper animations    (README-HEADLINES.md)
photofx.py        photo spotlight, real objects, depth pop (README-PHOTO-FX.md)
vox.py            Vox style collage scenes (README-VOX-STYLE.md)
avatar.py         the AI presenter; faces in assets/avatars/
kits.py           the look kits            (README-STYLES.md)
sfx.py            sound design and the music bed
farm/             the cloud farm           (README-RENDER-FARM.md)
motion.py         the classic motion graphics
samples/          one finished video per channel
assets/           fonts, maps and the satellite floor, textures, presenters, reference pictures
output/           your finished videos, one folder per channel
```

**Where a video lands.** Every channel has its own folder in `output/`. In it, every video has a folder named after
its title that holds only what goes to YouTube — the video once, its description (`<title> - description.txt`) and
its thumbnails. Everything else the render made — the voice, the footage, the segments, the plans — is in the
channel's `_work/` folder, so a re-render of the same title still reuses all of it.

```
output/documentary/
    Why Airplane Windows Are Round/
        Why Airplane Windows Are Round.mp4
        Why Airplane Windows Are Round - description.txt
        thumbnail_1.png
    _work/
        why-airplane-windows-are-round/
```

Videos made with an older Frontier sit straight in `output/` with the video twice. `python tidy_output.py`
shows how it would sort them into this layout; `python tidy_output.py --apply` does it and removes the
second copy of each video (nothing is re-rendered). On Windows, keep the output folder's own path short
(`FRONTIER_OUTPUT=D:\Frontier`, say): the working folders sit two levels deeper than they used to.

Every finished video is also in **Your videos** at the bottom of the app — **Open in Finder** (or
**Open in File Explorer** on Windows) opens its folder with the video selected, named after its title.

## Updates

Updates come from the Whop as a small pack. Unzip it anywhere and tell Claude Code
*"install the update in ~/Downloads/Frontier-5-UPDATE"*, or run it yourself:

    python Frontier-5-UPDATE/update.py Frontier-5-UPDATE --into ~/Desktop/Frontier

Files you never touched are replaced; files you changed are left alone, with the new version beside
them as `.new` for Claude to merge. Everything replaced is backed up first. Your `.env`, your styles
and your `output/` are never touched.

## Licence

You bought this. Use it, change it, run as many channels on it as you like. Don't resell the tool
itself. The satellite floor under the maps is Natural Earth (public domain); fonts are under their
own open licences in `assets/fonts/`.
