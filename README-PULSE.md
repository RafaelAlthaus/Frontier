# PULSE — the weekly AI briefing

A channel that ships one video a week: the twelve biggest things that happened in AI,
edited like a launch film rather than a news bulletin. It is the eighth look kit, and the
only one built around a presenter.

Pick **PULSE** in the app, type a title, press Create.

## What it looks like

Two grounds, switched hard. Near-black `#0D0D0D` for anything about a model — a launch,
a benchmark, a price. Paper white with a faint engineering grid for anything being
*reasoned* about, where one sentence builds a word at a time and the phrase that matters
gets a black box around it as it is spoken.

Type is Inter across its whole weight range: hairline at 200 for the big statements,
600–800 for numbers and names. One mono (Space Mono) for anything meant to read as an
interface. One italic serif word per contents card, as the only ornament in the system.

Three accents, each with exactly one job:

| | | |
|---|---|---|
| `#FF6D24` orange | the subject of a comparison | the bar this video is about, the winning cell, the headline figure |
| `#E58CA3` pink | one word inside a line | the key word of a statement, a name card |
| `#BEF242` lime | interface furniture only | the window keyline, the chapter counter |

Nothing else may use them. The colour *is* the argument: if two things are orange, the
chart has stopped saying anything.

## The scenes

`assets/kits/pulse.js` — one `build()` and one `frame(t)` per type, every frame computed
from `t` alone.

- **grid** — the contents of the episode: twelve tiles fly in from everywhere and lock
  into a grid, the title types over them, a spare tile slides out and becomes the note
  about timestamps. Only ever on the first cue.
- **typecard** — a model's name typed on black. The beat before a section starts.
- **logo** — the company's **official** logo, assembled out of the dark, with one line
  under it. Used the first time each company is named (see *Logos* below).
- **namecard** — the person behind an update: their real photo, their name set so large
  it runs off the frame edge, the role above it.
- **bench** — a real benchmark. Grey bars grow, the numbers count up with them, and the
  bar this update is about turns orange and lights *after* it has finished growing — the
  glow is the verdict, not the decoration. Gridlines step by a round 1/2/5, and the scale
  ends just past the biggest value so the longest bar nearly fills the frame.
- **multiplier** — one figure counting from A to B while speed lines rush past. For a
  speed or price claim the script actually makes.
- **spec** — two to four real launch figures (latency, price, context) in mono cells that
  fill one after another, each counting up.
- **versus** — two models, the same rows, the winner's cell lighting and the loser's
  dimming.
- **post** — a real post as the platform drew it, with one to three exact phrases
  highlighted on the words. Never a retyped quote.
- **annot** — the white page: the sentence builds, the phrase boxes, a boxed label hangs
  off a leader line pointing at the word it questions.
- **board** — the notebook page. An engineering grid the camera travels across while the
  argument is WRITTEN on it: a question in a box hangs off a leader line into the pink cell
  the sentence starts from, the line types itself with the view following the pen, the
  camera settles on a second beat, and a black `turn` chip ("But") drops the answer under
  it. `line` alone holds on one statement; a `$` inside a line is drawn as a money bag, not
  set as an emoji. Use it where the argument turns on itself — annot is for one sentence
  with a phrase in it, board is for the reversal.
- **bigline** — a statement over footage, hairline and huge, one word in pink.
- **snap** — the shutter. A real photo of the person behind the company; on the beat their
  cut-out burns white for two frames and falls back into the picture over 370 ms, the shot
  pushes right and the company's mark rises in on the black it leaves. A portrait is first
  widened to 16:9 (`widen.py`): the model paints only the sides, the real photo is laid back
  over the middle, so the face is never repainted.
- **tally** — one figure on spinning drums: every digit its own drum, blurred along its
  travel, landing left to right; the camera starts on one digit and pulls back to the whole
  number, its caption and an orange rule.
- **hand** — the week's cards: one card per update (the company's mark, the model, its one
  figure), dealt and fanned; the card the story is about is flown to the lens with a full
  turn and lights orange while the rest of the hand sinks out of focus.
- **race** — two models, one task: two terminals type the same prompt and stream real code
  at the same pace, and the frame freezes before the finish with *who finishes?* — it never
  shows a winner nobody has seen.
- **chat** — a model answering, on a desktop wallpaper: the prompt types, is sent, and the
  reply streams in. **The reply is the model's own**: the pipeline sends the prompt to the
  named model and shows what it answered (Anthropic models through the Claude route; a Gemini
  model only with an explicit `api_model`). A model it cannot reach gets no chat scene.
- **pricecut** — a price that fell: the old one struck through in orange and pushed aside,
  the new one dropping in with a bounce, the saving counting up in a chip.
- **breakout** — how a model got out, as a diagram: the test sandbox, the line through the
  gap in it to the open internet, branching to every system it reached. Never a hacker.
- **leaderboard** — a published ranking: the model climbs from its old rank, lifting over
  the rows it passes, its score counting up, lighting orange when it arrives.
- **timeline** — real dates on a line, the camera travelling to the last one — the news.
- **flip** — the turn into the next update: a split-flap counter going to 05 / 12, then the
  update's mark and name. The chapter card of a twelve-update episode.
- **context** — a context-window claim: pages fly into a long window that fills to the model's
  length while a counter runs up to it. Comparison marks only when the script makes them.
- **quote** — words someone actually said or published, verbatim, building a word at a time
  beside their photo, the phrase that matters turning pink.
- **picker** — "it is in the product now": a generic app window whose model menu opens, the new
  models tagged NEW, the cursor picking the one the story is about.
- **stats** — the week in numbers: up to four real figures in a grid, counting up, the lead one
  orange.
- **eval** — a published pass count as a grid filling cell by cell (23 / 26). The order of the
  cells is scrambled on purpose, so the scene never claims which one failed.
- **phone** — the model answering in a phone app. Like chat, the reply is the model's own.
- **ticker** — this week's updates running past like a news band, easing to a stop on the one
  the video turns to next.

Every scene carries its own sounds, timed off its own animation (`kits.sound_marks`) — the
snap's shutter is the loudest sound in the kit — and a shortest length it still plays in
full (`min_s`), so the director shortens a scene before it drops one. Every scene is also
filmed rather than displayed: it lands a touch close and creeps in while it is up (`camera()`
in pulse.js), except the ones that move their own camera.
- **hud** — footage in a lime window, an identity panel typing itself beside the subject
  with a leader arrow, a film-strip scrubber and the chapter counter.

Footage uses the **deck** treatment (`frames.py`): the shot inside a lime-keylined
rounded window on near-black, a film strip under it, and `04/12` telling the viewer which
update they are on. A vertical or 4:3 clip is letterboxed against a blurred copy of
itself rather than stretched.

## The presenter

`look.avatar` — **kiran**, a man at a white desk in a warm home studio: boom mic from the
right, bookshelf left, lamp, sofa, blue curtain. He opens the video and comes back
through it.

The rest of the avatar library is deliberately UGC — a phone propped on a desk, one
window. PULSE is the opposite register on purpose: a briefing channel is watched because
it looks like it knows something.

`count` is how many times he appears, `seconds` how long each time. Eight seconds every
40–60 s is the rate the format runs at, so a 15-minute episode wants 12–15 appearances.
`avatar.plan_windows` places them on sentence edges with ten seconds of pictures either
side; a target that cannot land there is dropped rather than forced, because a presenter
who starts mid-sentence reads as a glitch.

To use someone else, set `look.avatar.id` in `styles/pulse.json` to any presenter in
`assets/avatars/avatars.json`.

## Over the shoulder

`look.avatar.logos: true` — each time the presenter appears, the company he is talking
about (named in the subtitles of his window, or in the next eight seconds) gets its official
mark in a dark glass panel over his shoulder, sliding in a moment after the cut (`ots.py`).

## Logos

`logos.py` looks a company's official mark up the first time it is spoken and caches it
from then on, so `fetch("Moonshot AI")` works on the day Moonshot launches — a shipped
pack of twenty PNGs is out of date by the third video.

```bash
python logos.py get OpenAI Anthropic xAI "Google Gemini"
python logos.py check
```

Marks come from the company's Wikipedia article as SVG where one exists. A monochrome
mark that would vanish on the near-black ground is returned white; a mark with real brand
colour in it is never recoloured. `ALIASES` holds the judgements that a search gets
wrong — "Grok" is a chatbot with its own page but the mark people know is xAI's — and the
newest logo on a page wins, so Gemini does not come back as the Bard wordmark it replaced.

A company with no usable mark returns nothing and the scene draws its name as type, which
is what a news programme does.

On a dark ground a monochrome mark is returned white. A coloured mark keeps its colour, but
dark grey lettering inside it — Gemini's wordmark beside its gradient star — is lifted to
white (`_ondark.png`), so the name does not vanish on near-black.

## Footage

**YouTube only.** `look.youtube.sources` is `["youtube"]` and `archive_watch` is `0`: the
Internet Archive holds nothing about a model launched yesterday, so its search falls back
on whatever shares a word — on the first run of this style that was a 1992 adult-film
studio's catalogue. Stock is off for the same reason a stock shot of "a businessman using
AI" is worse than no shot at all.

The watcher order is `gemini → openlux → algrow → wavespeed → kie`: the free tier first,
then the cheap one, and a watcher that runs out of credit hands the video to the next.

`look.footage_taste` asks for launch keynotes, product demos, screen recordings of the
actual interface, and the offices of the company being discussed — and rules out glowing
brains, blue circuit boards and robot hands.

## Writing for it

`pacing.wpm` is 168 and `cut_s` is 2.6 — fast, but the sentences are short enough to
carry it.

The first sixty seconds are four stacked teasers, one per headline update, and nothing
else: who did it, what it is, the one number that makes it worth watching, then a hard
turn into the next. No greeting, no "in this video". The hook closes with how many
updates there are, the timestamps note and one line on what is at the end.

After that, one update per section, sixty to ninety seconds, biggest first, each opening
on the company's logo or a typecard.

Every figure has to be real. The style's script prompt says so and the fact-check step
enforces it — on the sample it caught a line implying Fable 5.1 was a competitor when it
is another Anthropic model, and rewrote it before a word was recorded.

## The sample

`samples/pulse.mp4` — two minutes from a hand-written, source-checked script
(`scripts/pulse-sample-2min.txt`). The narration was pasted rather than generated so the
sample shows the look without putting unverified numbers on screen; paste it into the app's
own-script box on PULSE to render it yourself. The sample is a showcase cut of the presenter and
the graphics only; a normal PULSE render of the same script also cuts in real footage, headlines
and posts, so it will not look identical. Its sound is what a PULSE video sounds like without an
Epidemic Sound key: the synthesised effects, no music.

## Trying the pieces without a video

```bash
python kits.py preview pulse              # every scene -> preview/kits/pulse_*.mp4 + .png
python kits.py preview pulse bench        # just one
python frames.py deck some_clip.mp4       # the footage treatment
```
