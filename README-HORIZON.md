# HORIZON — the data documentary

Big questions answered with real numbers: why a country stopped having children, how a currency collapsed, what an
ageing world will look like, where the jobs went. Real news footage full frame, and between it the numbers drawn big
and calm on a near-black navy. Pick **HORIZON** in the app, type a title, press Create.

## What a HORIZON video is made of

| On screen | When the director uses it | Where the numbers come from |
|---|---|---|
| **linechart** — the line a country draws; a glowing pen draws it while the camera follows, a dashed reference line (2.1, 0 %, a target), 2–3 marked years, then a pull-out to the whole line | a number's history over decades | a World Bank indicator for one country, fetched by the engine |
| **pyramid** — a real population pyramid, men left and women right, morphing year by year (1960 → 2024 → 2072), the first year kept as a dashed outline, children in red or the over-65s in amber | a population's age, its future | UN World Population Prospects 2024 (1950–2100) |
| **gens** — a hundred people, their children, grandchildren and great-grandchildren as rows of dots; the camera dives row by row and pulls out to the funnel | what a birth rate means over generations | computed from the rate the script states |
| **numroll** — one figure rolling to the next like an odometer (0.78 → 0.72, 2,700,000 → 686,000), or a single figure counting up | a number that changed, or one that matters | the script |
| **yearbars** — one bar per year, the camera travelling along them, one or two moments bracketed | a count per year | a World Bank indicator, or the script's own figures |
| **hbars** — countries or things side by side, the subject in red, a dashed reference | comparisons | the script / World Bank |
| **ticker** — one enormous sum typed digit by digit | a budget, a debt, a fortune | the script |
| **strike** — the things a generation gives up, struck through one by one | a list of losses | the script |
| **docshot** — the real document on the table (a poster, a letter, a page), the camera pushing in, a hairline note with its translation | a document the narration names | found by the photo search from the director's description |
| **quote** — near-black navy, a black-and-white portrait fading in, the exact words typed as they are read | a real person's words | the person's photo is found by name |
| **readline** — the one sentence the video turns on, each word lighting up as it is read, the key words boxed | the thesis | the narration |
| **titlecard** — the title opening its letter-spacing over black | after the cold open | — |
| **tab** — a navy chapter tab growing over the footage | each new chapter | — |

Around them the channel uses Frontier's own modules: **real YouTube footage** of the actual places and people
(watched by Gemini, picked sentence by sentence), **real newspaper headlines** with a maroon marker, **maps** in the
dark `midnight` skin, the **real people named** in a spotlight, **interview soundbites** with subtitles where the
script marks `[[clip: …]]`, and no burned-in captions.

## The numbers are real — how

`horizon.py` fetches every series the director names, once, into `~/.frontier/horizon` (no key needed):

- **World Bank** (`api.worldbank.org`): the director writes `"country": "JPN", "indicator": "SP.DYN.TFRT.IN"` — births
  per woman, population, life expectancy, GDP per person, the share aged 65+, births per 1,000, urban share,
  unemployment, inflation, and every other indicator the World Bank publishes for every country.
- **UN World Population Prospects 2024** (through PopulationPyramid.net's open data): the population of every country
  by 5-year age group and sex, 1950–2100 (the UN's medium projection after 2023). Each pyramid is checked against the
  World Bank's total population, so a wrong country code can never draw another country's pyramid.
- A year the World Bank has not published yet but the script states (last year's official figure) is added with
  `"add": [[2025, 0.80]]`.

A scene whose numbers cannot be fetched is **left out** — a chart with an invented line is worse than no chart. The
script itself is fact-checked before the voice (`factcheck.py`), and the graphics only ever print numbers that are in
the fetched data or the checked script.

Try it without a video:

```bash
python horizon.py wb KOR SP.DYN.TFRT.IN          # the series, year by year
python horizon.py pyramid JPN 1960 2024 2070     # three pyramids and their totals
python kits.py preview horizon                    # every scene -> preview/kits/horizon_*.mp4 + .png
python kits.py preview horizon pyramid            # one scene
```

## How it writes

The script follows a documentary's craft: a cold open that is a **scene** (a real person, a real moment) with the
country named in the first two sentences and the central number revealed one beat later; a bridge back to where the
story began; the number's history told as a line; one human detail per act; every number paired with what it means;
causes one at a time; a turn at the end (what changed recently, what experts disagree on) and a closing line that
recasts the title. Numbers are written as they are said aloud.

## Making it yours

- `voice` — Liam through ai33 by default (`AI33_API_KEY`); any ElevenLabs voice id works, or switch `provider` to
  `algrow`.
- `look.sound.epidemic` — with your own `EPIDEMIC_API_KEY` the channel's music and effects are chosen and edited per
  video from Epidemic Sound (dramatic / quiet / inspiring moods); without it Frontier's own sounds play.
- `pacing.body_notes` — tells the director which graphic carries which kind of sentence.
- The scene designs live in `assets/kits/horizon.js`; the director's menu (and the preview examples) in
  `kits.py` → `KITS["horizon"]["prompt"]`.

Fonts: Playfair Display and Poppins (SIL Open Font License), embedded into every frame.
