# ALMANAC — the history of people and things

A channel for stories about who someone was and what a thing was: a gangster, an inventor, a ship, a machine, a
building, a company, a scandal. It reads like an encyclopedia entry or a collector's card: real archive film and
real photographs, printed in three inks, with the names, objects, figures and verdicts of the story set as print.

Pick **ALMANAC** in the app, type a title, press Create.

## What it looks like

Two grounds, both taken off printed matter: a charcoal table (`#282828`) with a rounded black **card** on it — a
mustard band, a black stripe, an off-white paper band with a faint fibre grain and printed veins — and a clean
white **page** with a dark bar across it.

| ink | | its job |
|---|---|---|
| `#E6BE61` mustard | the card's band | where the titles rise |
| `#F8D848` yellow | a name on the dark bar | a person, the first time they matter; a figure in the tally |
| `#151515` ink | titles, the film's blacks | everything that is set |
| `#F3F1ED` paper | the card's paper band, the film's whites | small text, engraved |
| `#C8372D` red | the proof stamp | only the verdict |

Type is Inter throughout (`Kit Sans`, the variable face in `assets/kits/fonts/`), heavy for titles, with every letter
**rising out of a mask line** — the band's or the bar's bottom edge — one after another with a small overshoot.
Paragraphs fade in line by line, letterpressed into the paper. Photos are **cut-outs** with soft shadows that
overlap the type on purpose.

Every piece of film, in the templates and between them, is graded into the same two inks — mono, a touch of
contrast, blacks printed as ink, whites as paper — so a newsreel from 1923 and a clip from 1931 read as one stock.
In the page that is `almGrade` (core.js); on plain footage it is the style's `look.footage_grade`, the same chain in
ffmpeg.

The scenes run on whole frames (`almSharp`), like the two references they were measured from: the renderer's motion
blur only touches moves that should smear (the film strip spinning up, the card wall's flip).

## The seven templates

`assets/kits/almanac.js` — one registry, `SCENES[type]`, every frame computed from `t` alone. The director picks
them (`director.py` reads the kit's prompt in `kits.py`); the JSON below is what it writes. Values are always the
script's own — the examples only show the shape.

### bar — a person's name (5.1 s)
Reference A. A dark shutter drops off the page, the person's black-and-white cut-out slides in, a dark bar grows
behind them, the name rises in yellow out of the bar's bottom edge, one line of fact fades in under it.

```json
{"type": "bar", "name": "Al Capone", "sub": "Born 17 January 1899 · Brooklyn, New York",
 "subject": "Al Capone", "query": "Al Capone 1930 portrait photograph"}
```
`name` ≤ 22 characters, `sub` ≤ 60. Optional: `side: "right"` (person right, name left), `bw: false` (keep colour),
`sub_at` (when the line fades in). **Use it** the first time a person matters — never twice for the same person.

### card — a thing (5.1 s)
Reference B, the collector's card. The card pops in, the mustard band wipes down, the title rises, the object's
colour cut-out lands on top of the title, the paper band grows up and a short paragraph is engraved into it.

```json
{"type": "card", "title": "ROVER V8", "text": "Buick's all-aluminium V8, bought by Rover in 1965. It went on to power the Range Rover and the MGB GT V8.",
 "thing": "Rover V8 engine"}
```
`title` in capitals, ≤ 10 characters reads best (≤ 14 fits); `text` ≤ 170 characters. `thing` is what to photograph;
`subject` + `query` instead for a person. Optional: `rotate` (the object's resting angle, −6), `scale`, `obj_x` /
`obj_y` (move a tall document off a key word). **Use it** for an object, machine, building or document the story
turns on, the first time it is named.

### reel — a new era (9.6 s)
The card's stripe is a strip of 35 mm film carrying the video's own archive footage, **every cell its own shot**. The
cells develop while the strip glides under the title, the strip spins up and **coasts down in one smooth move** until
the gate frame comes to rest, then the camera **dives into that frame** and the film becomes the screen, with an
index tab naming the place.

```json
{"type": "reel", "title": "PROHIBITION", "text": "17 January 1920. Making, selling or transporting intoxicating liquor is now illegal in the United States.",
 "label": {"name": "Chicago", "sub": "the 1920s"}}
```
`title` ≤ 14 characters, `text` ≤ 150. Optional: `counter` (a key code on the film's edge, not a year), `edge` (the
film's edge legend), `open_at` (when the dive starts), `open: false` (stay on the card). **Use it** to open the video
or a new era or place — at most once every two minutes. It needs 9–10 s; `pacing.graphic_max_s` is 10 for it. A
video with no archive film for it plays the moment as a **card** (same title and text): an empty strip for ten
seconds is dead air.

### hand — the people of one moment (6.4 s)
A deck lands on the table and fans into a hand of 2–5 collector cards, each printing itself: name, tag, a real
photo, one line of fact. One card is **pulled from the hand and turned to the lens**; the others drop out of focus,
and a bar runs out from behind the card with why that person matters next.

```json
{"type": "hand", "kicker": "The beer business", "title": "Chicago, 1925", "back": "The Capone Case",
 "cards": [{"name": "Dean O'Banion", "tag": "North Side", "role": "North Side boss. Shot dead, November 1924.", "subject": "Dean O'Banion"},
           {"name": "Johnny Torrio", "tag": "The Fox", "role": "South Side boss. Shot, 24 January 1925.", "subject": "Johnny Torrio"},
           {"name": "Al Capone", "tag": "The Heir", "role": "Takes over the Outfit in 1925. Age 26.", "subject": "Al Capone"}],
 "hero": 2, "hero_title": "The boss at 26.", "hero_text": "Torrio survives a North Side ambush in January 1925, hands Capone the Outfit and leaves Chicago."}
```
2–5 cards (fewer is left out, more are cut to five); `name` ≤ 18, `role` ≤ 45, `hero` = the index to pull
(−1 = none), `hero_title` ≤ 60, `hero_text` ≤ 140. Optional: `series` (the channel's name on the backs),
`pull_at`. **Use it** when two to five people share one moment — a gang, a cabinet, a band, the sides of a case.
A card whose person has no public photo is left out of the hand; a hand with fewer than two photos is left out, and
the hero is pulled only when their own photo was found (nobody is pulled otherwise).

### tally — one big figure (6.8 s)
The figure is too long for the frame: every digit is a **cash-register drum** that spins up out of the mask line and
clunks to a stop as the camera dollies along it, then the camera pulls back to the whole number — on the page next
to the person's cut-out with archive film running inside the bar, or, without a person, on the card.

```json
{"type": "tally", "value": 100000000, "prefix": "$", "headline": "a year · the whole operation's estimated gross, late 1920s",
 "source": "The Mob Museum", "subject": "Al Capone", "query": "Al Capone 1931 photograph"}
```
`value` a plain number, or `text` for a figure that is not one; `prefix` / `suffix`, `decimals`. A model's
"100,000,000", "$1.2bn", "4.2 billion", "40%" or "1,000+" is read as the number it means (the currency sign and the
`%` / `+` move to `prefix` / `suffix`); anything else with words in it ("100 million dollars", "1-2 million") drops
the scene rather than ring up a wrong figure. Card form: `kicker`, `headline`, `body`, `source`, and
`thing` for an object (the document) instead of a person. Optional: `camera` (`auto` | `dolly` | `still`),
`skin` (`page` | `card`). **Use it** for the figure the story turns on, said in the narration.

### cardwall — a turning point (7.1 s)
Full-frame archive film **cracks into a wall of collector cards**. A diagonal wave flips them in 3D; their backs are
slices of one card, so the person's portrait assembles across the tiles, the gutters close, the tiles fuse into one
card, the title rises behind the photo and the photo peels off the page.

```json
{"type": "cardwall", "title": "FEB 14, 1929", "body": "Capone is at a hearing in the Dade County Solicitor's office in Miami. No one is ever charged with the killings.",
 "split_at": 0.8, "subject": "Al Capone", "query": "Al Capone Miami 1930 photograph"}
```
`title` a date or a short word (≤ 12 characters; 5–6 reach the reference's size), `body` ≤ 180. Optional: `split_at`
(film before the crack), `grid` (`[5, 3]`, `[4, 3]`, `[6, 4]`), `face_tile`, `title_tuck` (how much of the last
letter the head may cover; a date wants about 0.05), `stripe_label`, `image` (a still instead of film). **Use it**
at a turning point, on the words that turn it.

### register — the verdict (5.6 s)
The page is **printed while you watch**: three ink plates fly in out of register with their crop marks and snap into
place, the portrait resolves from halftone dots into a photograph and peels off the page, the proof is trimmed to a
full-bleed page, and a red **proof stamp** slams the verdict.

```json
{"type": "register", "title": "GUILTY", "kicker": "U.S. v. Alphonse Capone · October 1931", "subtitle": "$50,000 fine + $7,692 court costs",
 "stamp": "11 YEARS", "stamp_sub": "SENTENCED · 24 OCT. 1931", "subject": "Al Capone", "query": "Al Capone portrait 1930"}
```
`title` ≤ 7 characters on one row (≤ 14 on two), `kicker` ≤ 60, `subtitle` ≤ 50, `stamp` ≤ 10. Optional: `stamp_at`,
`body` (≤ 3 lines; better empty with a stamp), `band: "yellow"`, `misregister` (0.5 polite … 1.6 wild), `duotone`,
`series` / `folio`. **Use it** once, for the verdict the whole story built to — a sentence, a sale, a ban, a record.

## Where the pictures and the film come from

Nothing is drawn. `kits.generate` finds every picture before a scene is rendered (`_almanac_media`):

- **People** (`subject` + `query`: bar, hand's cards, tally, cardwall, register): `photofx.source_photos` finds real
  photos of the person, the first one this video has not shown yet is cut out of its background
  (`photofx.cutout`), and `almanac_prep.trim_cutout` crops the cut-out to the figure — a remover leaves the whole
  frame around a person, which would shrink them and float them off the page. "Not shown yet" is judged by the
  picture itself (its bytes, and an average hash for a copy from another site), so one photograph is never on
  screen twice in a video.
- **Objects** (`thing`: card, tally's card form): `photofx.source_thing` — a real photo, cut out and trimmed. When
  no photo of the object cuts out cleanly, the card looks for it the way it looks for a person (search, pick, remove
  the background), which finds pictures the object search rejects. `look.photofx.draw_objects` is off: an object
  with no photo at all is left out, never drawn.
- **Film** (reel, cardwall, the tally's bar): the video's own YouTube and Internet Archive clips
  (`youtube/clips.json`; stock clips never play in the strip), the ones found for the words nearest the scene that
  no other scene has taken. The reel prints up to 8 of them, one per cell and one per source video first. The gate
  the camera dives into is the nearest clip that lasts from where the strip slows down to the end, and one found for
  words that name the tab's place (`label.name`) comes first. With no such clip it is the longest, which holds its
  first frame as it comes in so that it still plays to its last frame: up to about 0.9 s short, that hold is lost in
  the fast coast; a clip shorter still waits in the gate as a still frame while the strip rests. The others go to
  the cells nearest first, the two nearest resting beside the gate. The reel takes 6 clips whenever the video has
  them, so every cell you can read carries its own shot, and a third of a larger archive (up to the 8), so the
  timeline keeps its footage. With fewer than 6, the readable cells repeat a shot, but never play it in step. A
  small archive therefore goes to the reel first: a later card wall or tally in the same video can be left without
  film. The tally's bar plays the nearest clip that lasts the scene, else two or three in a row. The clips a scene plays are written to `motion/kit_footage.json`, and the timeline leaves them out, so no shot
  runs twice.
- **Newspapers**: `look.headlines.real_only` — the press moments show a real scanned page or none; no wire story is
  written and printed (or drawn) as the day's paper.

`almanac_prep.py` then turns the film into frame lists (deinterlaced, square-pixelled, cover-cropped, cached in the
job under `motion/almanac/`) and gives every cut-out its metadata — aspect, the sides the photo was cut by its frame,
and where the face is — which the scenes use to place the head, bleed a cut edge off the card and keep the type
clear of the silhouette. The face comes from a silhouette rule that works everywhere; on a Mac, a Vision face-box
tool is asked first when one is installed (`$ALMANAC_FACEBOX` or `tools/facebox`). It is optional.

**Every miss degrades, nothing fails.** No photo: the scene renders without it (the tally sets on the card instead
of the page). No film: the reel plays as a card, the card wall cracks at once. A hand with fewer than two photos, or a
tally whose value is not a number, is left out. A picture value the director invents (a name where a file belongs)
is ignored and the picture is fetched as usual; a picture the browser cannot decode plays as the scene without it. A
scene already rendered is not fetched again: `motion/kit_NN_type.clips.json` keeps the scene as it was rendered —
its pictures, its film and the timings the film decided — so its sounds stay on its beats.

**The director** (`pacing.rank`) weighs the kit's graphics above a map on the same cue: the map becomes a place label.
A graphic near the end of the video is shortened to the least it still plays in full (`min_s` in `kits.py`) before
it is left out. **The texts** the graphics print are fact-checked like the script (`factcheck.check_texts`, with the
same switch), before they are rendered. **No footage at all** (YouTube refusing this address, say) is announced as
a warning in the log with yt-dlp's own reason; the video then fills its slots with drawn pictures, never showing one
twice while the picture before it can hold a little longer.

## Writing for it

`pacing.wpm` is 140, cuts every 3.4 s, a graphic about every 50 seconds and up to 10 s long. The script prompt asks
for a present-tense cold open with the identity held back a beat, the bridge back to the beginning, every sentence
carrying something a camera, a photograph, a newspaper or a map can show, one humanising detail per act, and numbers
said aloud and paired with what they meant. The outline plans the big moments the kit is built for: a new era, the
people of one moment, the figure, the turning point, the verdict.

Real facts only — fact-check the script before the voice records. Footage is YouTube **and** the Internet Archive
(`look.youtube.sources`): public-domain newsreels are the heart of this look.

## Tips

- The best topics have **public-domain photographs** of their people (police records, government and press photos,
  Wikimedia Commons) and **archive film** of their era. A story about someone with no public photo leaves bars and
  cards without a person — pick another template for them.
- A title on the card or the proof is set big: short words read best. `GUILTY`, `SOLD`, `1929`, `ROVER V8`.
- Captions are a clean line on an ink band; the director's text labels are the yellow name on a dark bar, top-left.
- Music: Frontier ships none. The style names three tracks by file name (`look.sound.track`) and rotates them per
  video when they are anywhere under `assets/music/`; without them it plays what you put in `assets/music/almanac/`
  (or straight in `assets/music/`).

## Trying the pieces without a video

```bash
python kits.py preview almanac            # every template -> preview/kits/almanac_*.mp4 + .png
python kits.py preview almanac hand       # just one
python kits.py check                      # one frame of every scene of every kit
python almanac_prep.py scene.json out.json --inline   # prepare a scene by hand (footage, cut-outs, data URIs)
```

The previews use the kit prompt's own examples, with no photos or film: they show the type, the motion and the
degraded forms. A real video fills them with the people, objects and archive film of its story.
