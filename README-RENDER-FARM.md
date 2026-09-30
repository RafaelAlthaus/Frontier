# THE RENDER FARM

Frontier normally renders on your own computer, and for one video at a time that
is the right place: it is free, and your machine is almost certainly faster per
core than anything you can rent. The farm is for when that stops being the
problem — when you want five videos while you sleep and your laptop back.

It splits each video in half. The waiting happens here; the computing is rented.

Most of a render is not your processor working — it is waiting on somebody's API.
Claude writing the script and directing the edit, ElevenLabs speaking it, an image
model drawing the stills: measured across real jobs, **70–85% of the clock is
waiting**, and on a bad day far more (a stalled image step once waited 77 minutes,
a stalled director 50). Renting a machine to do that is paying by the hour to sit
still.

So all of it is done here, where waiting is free and the Claude calls go through
the Claude Code you are already signed into. What comes out — the voice, the
stills, the plan of the edit — is a **median of 2.5 MB**, seconds to send. Only
then is a machine rented, and it starts at the part that is genuinely processor
work: the footage, the graphics, the encode.

One machine per video. Each renders, uploads, and switches itself off.

---

## Be clear about what this buys you

It is worth saying plainly, because the obvious assumption is wrong.

**It does not make one video render faster.** A rented machine has more cores
than your laptop but slower ones. A single video will usually take *longer* on
a pod than on a recent Mac.

**What it buys is three things:**

1. **Your computer back.** Rendering pins every core for hours. On the farm you
   close the lid.
2. **Five at once instead of one.** This is the whole point. Five machines
   finish five videos in about the time one machine finishes one.
3. **A datacentre's connection.** Downloading the YouTube footage is a real
   slice of the clock, and a pod does it on a line hundreds of times faster
   than a flat's.

If you make one video a week, stay local. If you are running a channel that
posts every day, the farm is the difference between a machine you cannot use
and a machine you barely touch.

---

## What it costs, honestly

Three separate bills, and the machine is the smallest of them.

| | Roughly | Notes |
|---|---|---|
| **The machine** | **$0.10–0.30 a video** | An RTX A4000 on RunPod's community cloud is about **$0.17/hr**. You are renting it for its processors — Frontier never touches the graphics card — and on RunPod a cheap GPU pod is usually the least expensive way to get eight-plus cores. It is only up for the computing half, which is why this is low. |
| **The usual API calls** | **unchanged** | Voice, pictures, footage. About $0.50 per minute of finished Documentary, exactly as when you render at home. |
| **Claude** | **new — watch this one** | ⚠️ At home, Frontier writes scripts and directs edits through the **Claude Code you are already signed into: free**. A rented machine has no such login, so every one of those calls becomes a paid Anthropic API call. |

That last row is the one that surprises people, so the farm is built around it.
**The script, the voiceover, the stills and the director's plan of the edit are
all made on your computer before any machine is rented.** Those are the calls
that would otherwise be bought twice over — and the script is the one you want to
read before paying to have it spoken, filmed and cut anyway.

What still costs Anthropic money on the pod is the smaller stuff: choosing the
YouTube shots, and the labels and graphics as they are built. Frontier uses
Claude Sonnet 5 throughout ($2 per million tokens in, $10 out). Look at your
Anthropic dashboard after the first video rather than trusting an estimate here.

The one thing deliberately left on the pod is **downloading the YouTube footage**.
It is 26–778 MB of raw clips: pulled here it would come down your line from
YouTube and then go straight back up to the pod — the same bytes twice — where
the pod fetches them on a datacentre connection straight into the render.

There are two ways to bring it down: set `KIE_API_KEY` and
`CLAUDE_PROVIDER=kie` in your `.env` (kie.ai resells Claude for roughly 40% of
the price), or `CLAUDE_UTILITY_MODEL=claude-haiku-4-5` for the small calls.

---

## Setting it up — about fifteen minutes

Tick **CLOUD RENDER** in the app and it lists these four as you connect them, so
you can follow along there instead of here if you prefer.

### 1. Cloudflare R2 — where the finished videos land

A pod cannot hand a file to your laptop, so it puts it somewhere you can fetch
it from. R2 is the recommendation for one reason: **downloading your own files
costs nothing.** Ten videos come to about two cents a month to keep.

1. Make a free account at [dash.cloudflare.com](https://dash.cloudflare.com).
   A card is needed to switch R2 on; at this volume nothing is charged.
2. Left menu → **R2 Object Storage** → **Create bucket**.
3. Name it `frontier-farm`. **Leave Location on Automatic.**

   > Do not pick *Specify jurisdiction*. That changes your endpoint to
   > `…eu.r2.cloudflarestorage.com` and you would have to correct it by hand.
4. Back on the R2 page, find **Account details** → next to **API Tokens** press
   **Manage**.
5. **Create API token** → **Account API token** → permission **Object Read &
   Write** → limit it to that one bucket.
6. It now shows three things. **The Secret Access Key is shown once and never
   again** — copy all three before you close it:

   | | looks like |
   |---|---|
   | Access Key ID | `a1b2c3…` |
   | Secret Access Key | a long string |
   | S3 endpoint | `https://<account id>.r2.cloudflarestorage.com` |

Backblaze B2, Wasabi and AWS S3 speak the same protocol; put their endpoint in
instead if you already have one.

### 2. RunPod — the machines

**There is nothing to choose and nothing to deploy.** Community Cloud is not a
product you buy, it is where RunPod looks for a free machine, and it is already
the default. Frontier orders the machine over the API and it deletes itself
afterwards. You only ever visit RunPod for these two things:

1. Make an account at [runpod.io](https://runpod.io).
2. **Billing** → add **$10**. At about eight cents a video that lasts a long time.
3. **Settings** → **API Keys** → **Create API Key**, permission **All**.

   > Not Read Only. The key has to be able to *delete* a pod, or nothing ever
   > switches itself off and your credit drains.
4. Copy it. RunPod does not store it and will not show it again.

### 3. A Claude key for the machine

At home Frontier writes scripts through the Claude Code you are already signed
into. A rented machine has no such login, so those calls have to be bought.

[console.anthropic.com](https://console.anthropic.com) → **API Keys** → create
one → put a few dollars on it.

### 4. Put them in `.env`

```bash
RUNPOD_API_KEY=the key from runpod

FARM_BUCKET_ENDPOINT=https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com
FARM_BUCKET=frontier-farm
FARM_BUCKET_KEY_ID=the access key id from r2
FARM_BUCKET_SECRET=the secret access key from r2

ANTHROPIC_API_KEY=the key from anthropic
```

That is all of it. Which card to rent, how many machines at once, the watchdog
and the budget cap all have sensible defaults.

### 5. Check before you spend anything

```bash
python -m farm.farm check
```

It writes a test file to your bucket, reads it back, lists it, deletes it, and
asks RunPod whether your key works. **It rents nothing.** Do not go further
until every line is a tick — otherwise you find out an hour into a render.

---

## Using it

### From the app

Run `python app.py` as usual. Under the Create button there is now **CLOUD
RENDER**. Until the four things above are connected it is greyed out and lists
what is still missing; once they are, tick it and the button becomes *"Prepare
it here, then render on the cloud"*.

Pressing it does the waiting half on your computer — script, voice, thumbnail
and the director's plan — and adds the job to the queue. **This takes a few
minutes and rents nothing.** Queue as many as you like, read the scripts, then
press **Start the farm**. Underneath, **Finished on the farm** lists everything
in the bucket with a Download button. Do that for as many videos as you want, read the scripts,
then press **Start the farm**.

### From the command line

```bash
python -m farm.farm queue "New Coke: The 79-Day Disaster That Saved Coca-Cola" --style documentary
python -m farm.farm queue --titles-file titles.txt --style documentary --minutes 18
python -m farm.farm list                 # read the scripts in farm_queue/ first
python -m farm.farm run --pods 5
python -m farm.farm pull                 # into output/, same as a local render
```

While it runs, `python -m farm.farm status` says what every machine is doing,
and the log of each video is in your bucket under `logs/` as it happens.

### Collecting them

**Finished on the farm**, under the farm panel in the app, lists everything in
the bucket — read from the bucket itself, because a pod uploads its video and
then deletes itself, so that is the only place that knows what exists. Each one
has three buttons:

- **Download** — straight from the bucket to your browser on a signed link. It
  does not travel through Frontier on the way, so it comes down at whatever
  speed your connection manages, and on R2 it costs nothing.
- **Save to output/** — puts the whole job on disk where a local render would
  have put it.
- **Delete** — removes it from the bucket. Nothing on your computer is touched.

`python -m farm.farm library` is the same list in the terminal, and `pull`
fetches everything at once.

### What one actually looks like

A 10-minute Documentary, measured end to end on 2026-09-20:

```
  machine time     27.1 min
  machine cost     $0.077   (RTX A4000, 14 vCPU / 62 GB, at $0.170/hr)
  Algrow           3.50 credits
  WaveSpeed        $0.030
  delivered        321 MB — 8:00 of 1080p30
  uploaded from this computer      7.2 MB
```

`python -m farm.farm report` prints that for any video, read back off the log the
pod left in your bucket. It includes what Claude cost, counted from the token
usage every reply carries.

Where the time went: about sixteen minutes drawing graphics and researching
footage (Gemini watched 80 videos and logged 863 usable shots), four minutes
encoding 87 segments across 6 workers, five minutes on sound and the final mux.

### If you want everything off, right now

```bash
python -m farm.farm kill
```

Or the red button in the app. This is the one command worth remembering.

---

## How your money is protected

A pod that finishes its video and stays switched on is the only way this becomes
expensive, so it is guarded four times over:

1. **The pod switches itself off** when the render ends — after success, and
   inside a `finally` after a crash.
2. **A watchdog inside the pod** kills it at `FARM_MAX_MINUTES` (240 by default)
   no matter what the render is doing, even if it is wedged inside ffmpeg.
3. **Your computer watches too**, and terminates anything that overruns.
4. **`farm.farm kill`** switches off everything with one command, and tells you
   plainly if one refused so you can go and do it by hand.

On top of that, `FARM_BUDGET_USD` (default 10) stops a batch that has spent more
than you meant to, and `FARM_MAX_PODS` (default 5) caps how many exist at once.

If a terminate ever fails, every layer says the same sentence: *switch it off at
runpod.io*. Believe it and go and look.

---

## Settings

| | Default | |
|---|---|---|
| `FARM_GPU` | `NVIDIA RTX A4000` | The card you rent for its processors. `python -m farm.farm machines` lists what is available and what it costs. |
| `FARM_VCPU` / `FARM_MIN_RAM` | `8` / `24` | The floor. Fewer than 8 cores and a render crawls. |
| `FARM_CLOUD` | `COMMUNITY` | `SECURE` costs more and is more reliably available. |
| `FARM_DISK_GB` | `150` | A render's working files — raw footage, frame sequences — are far bigger than the video. |
| `FARM_MAX_PODS` | `5` | How many at once. |
| `FARM_MAX_MINUTES` | `240` | The watchdog. |
| `FARM_BUDGET_USD` | `10` | A batch that costs more than this is stopped. |
| `FARM_IMAGE` | `python:3.11-slim-bookworm` | See below. |
| `FARM_CPU` | *(unset)* | Set to a CPU flavour (`cpu3g`, `cpu5c`) to rent a CPU-only pod instead. They top out at 8 cores and usually cost more per core than a cheap GPU pod. |

### Making pods start faster

A fresh pod installs ffmpeg, Chromium and the Python packages before it can
render — four to eight minutes, about two cents. If you render every day and
would rather not wait:

```bash
docker build --platform linux/amd64 -t <you>/frontier-render:1 -f farm/Dockerfile .
docker push <you>/frontier-render:1
# then in .env:
FARM_IMAGE=<you>/frontier-render:1
```

`--platform linux/amd64` matters: RunPod machines are x86, and an image built on
an Apple Silicon Mac without it will start and then fail. Frontier's own code is
**not** baked into the image — it still arrives from your bucket each time — so
editing a style file never means rebuilding.

---

## Things worth knowing

**Your footage memory follows you.** `youtube_used.json` is how Frontier never
uses the same clip twice. The bucket holds the master copy; each pod reads it at
the start and writes back only what it added, under its own name, so five
machines finishing at once cannot overwrite each other. `pull` folds it all back
into your own copy. The honest limit: pods running *at the same time* cannot see
each other's choices, so two videos rendered side by side could pick the same
clip. Across batches — where repetition actually shows — it holds.

**Algrow allows 30 requests a minute.** The voiceover uses most of that on its
own while it is recording, which is another reason it happens here, one job at a
time, instead of on five pods at once.

**Queueing is not instant any more, and that is the point.** `queue` records the
voice and draws the stills before it returns, so a job takes a few minutes to
prepare. That is the work you are choosing not to rent. Queue a batch, go away,
come back and read the scripts, then `run`.

**Bring-your-own voiceover does not work on the farm.** It names a file on your
computer that the pod cannot see. Render those at home.

**Your keys never touch the bucket.** RunPod is given them directly, encrypted
on their side, and the code bundle uploaded to your bucket has your `.env`
excluded. `python -m farm.farm check` will not proceed without the keys a render
needs, so you find out here rather than an hour into a pod.

**"No availability."** Community cloud runs on other people's machines and some
cards come and go. Try `FARM_CLOUD=SECURE`, or another card from
`python -m farm.farm machines`.

**A pod died and I do not know why.** Its log is in your bucket at
`logs/<slug>.log`, and it was uploaded before the machine was switched off —
including the traceback, if it crashed.
