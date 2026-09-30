"""avatar.py — the AI presenter that opens a video.

WHAT IT DOES
------------
The voiceover is rendered ONCE, whole, so the delivery never changes tone
half-way. Then the first few seconds are cut off it — at a real pause, never
mid-word — and those seconds are handed to an audio-driven avatar model
together with a portrait. What comes back is a talking presenter that says the
opening lines, and the video carries on with pictures from there.

WHY THE CUT MATTERS
-------------------
Cutting on a stopwatch lands mid-syllable and the join is audible. The
subtitles already know where the speaking stops: every cue END is a pause, and a
cue whose text ends in `.`, `!` or `?` is the end of a sentence — a real breath.
`cut_point()` looks for one of those near the length that was asked for, and
only falls back to a plain cue end if the sentence boundaries are too far away.

THE LIBRARY
-----------
`assets/avatars/avatars.json` holds the presets — id, gender, niches and the
prompt that drew them. `library()` reads it; the UI shows the ones whose gender
matches the channel's voice, because a man's voice under a woman's face reads as
broken before anyone works out why.

PROVIDERS
---------
kie's Kling Avatar is the default: 720p native at $0.0375/s, the best picture
per dollar of anything measured, capped at 15s per clip — which an intro never
exceeds. WaveSpeed's InfiniteTalk is the alternative for longer takes (up to 10
minutes) or when kie is out of credit — chosen per channel with look.avatar.provider,
never switched to behind your back, because it looks and costs different.
"""

import json
import os
import re
import subprocess
import time
from pathlib import Path

import requests

HERE = Path(__file__).resolve().parent
LIB_DIR = HERE / "assets" / "avatars"
MANIFEST = LIB_DIR / "avatars.json"

# Per second of finished clip. Measured on 2026-09-20, not read off a price page.
PROVIDERS = {
    "kling-standard": {"label": "Kling Avatar Standard", "res": "1280x720", "usd_s": 0.0375, "max_s": 15},
    "kling-pro":      {"label": "Kling Avatar Pro",      "res": "1920x1072", "usd_s": 0.0750, "max_s": 15},
    "infinitetalk":   {"label": "InfiniteTalk 720p",     "res": "1264x720", "usd_s": 0.0600, "max_s": 600},
    "infinitetalk-480": {"label": "InfiniteTalk 480p",   "res": "832x464",  "usd_s": 0.0300, "max_s": 600},
}
DEFAULT_PROVIDER = "kling-standard"
KIE_USD_CREDIT = 0.005        # kie bills these models in credits, and a credit is $0.005
MAX_SECONDS = 15          # what the UI slider offers
MIN_SECONDS = 1

MOTION_PROMPT = ("The person speaks naturally to camera, subtle head movement, natural blinking, "
                 "relaxed shoulders, small hand gesture, static camera.")


# ── the library ─────────────────────────────────────────────────────────────

def library(gender: str = "") -> list:
    """The avatar presets, newest field set first. `gender` ("male"/"female") filters;
    anything else returns the lot. Missing manifest -> empty list, never a crash."""
    if not MANIFEST.exists():
        return []
    try:
        rows = json.loads(MANIFEST.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    g = (gender or "").strip().lower()
    out = []
    for r in rows:
        if not isinstance(r, dict) or not r.get("id"):
            continue
        if g in ("male", "female") and (r.get("gender") or "").lower() != g:
            continue
        f = LIB_DIR / (r.get("file") or f"{r['id']}.png")
        if not f.exists():
            continue
        out.append({"id": r["id"], "gender": r.get("gender", ""), "niches": r.get("niches") or [],
                    "file": str(f), "persona": r.get("persona", "")})
    return out


def portrait(avatar_id: str) -> Path:
    """The picture for an id. An unknown id falls back to the first preset so a
    stale favourite in someone's browser can never stop a render."""
    rows = library()
    for r in rows:
        if r["id"] == avatar_id:
            return Path(r["file"])
    if rows:
        return Path(rows[0]["file"])
    raise FileNotFoundError(f"no avatar library in {LIB_DIR}")


# ── finding the cut ─────────────────────────────────────────────────────────

_TS = re.compile(r"(\d{2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{1,3})")


def _secs(h, m, s, ms) -> float:
    return int(h) * 3600 + int(m) * 60 + int(s) + int(ms.ljust(3, "0")) / 1000.0


def cues(srt: Path) -> list:
    """[(start, end, text)] from an SRT. A file that will not parse gives []."""
    try:
        raw = Path(srt).read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return []
    out, cur = [], None
    for line in raw.splitlines():
        m = _TS.search(line)
        if m:
            cur = [_secs(*m.groups()[:4]), _secs(*m.groups()[4:]), []]
            out.append(cur)
            continue
        s = line.strip()
        # A bare number is the NEXT cue's index, not this cue's words. Letting it
        # through appends "3" to "in their head." and the sentence stops looking
        # like a sentence — which silently costs every full-stop cut.
        if cur is not None and s and not s.isdigit():
            cur[2].append(s)
    return [(a, b, " ".join(t)) for a, b, t in out]


def cut_point(srt: Path, want_s: float, window: float = 4.0, max_s: float = 0) -> float:
    """Where to cut the audio so the avatar stops on a pause, as close to
    `want_s` as the speech allows.

    A cue that ends a SENTENCE is a real breath and is always preferred; a plain
    cue end is the fallback. Ranked by DISTANCE from what was asked for, not by
    which comes first — the nearest pause may well be after `want_s`.

    `max_s` is the model's hard ceiling. Candidates beyond it are dropped HERE
    rather than clamped by the caller: clamping lands the cut on the ceiling,
    which is an arbitrary instant mid-word — the exact thing this function is
    for avoiding."""
    cs = cues(srt)
    if not cs:
        return float(want_s)
    cap = float(max_s) if max_s and max_s > 0 else float("inf")
    ends_sentence = [e for _, e, t in cs if t.rstrip().endswith((".", "!", "?", "…")) and e <= cap]
    plain = [e for _, e, _ in cs if e <= cap]
    for pool in (ends_sentence, plain):
        near = [e for e in pool if abs(e - want_s) <= window]
        if near:
            return min(near, key=lambda e: abs(e - want_s))
    # Nothing close: the last pause at or before the target, else the earliest
    # pause that still fits under the ceiling.
    before = [e for e in plain if e <= want_s]
    if before:
        return max(before)
    return min(plain) if plain else min(want_s, cap)


def cut_audio_range(mp3: Path, start: float, end: float, dest: Path) -> Path:
    """Seconds `start`..`end` of `mp3`, re-encoded so both edges are sample-exact.

    The seek sits AFTER the input on purpose: seeking before it snaps to an mp3
    frame and can start the clip a word early, and a presenter whose lips run a
    syllable ahead of the voice is worse than no presenter."""
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    ff = os.environ.get("FFMPEG_BIN") or "ffmpeg"
    subprocess.run([ff, "-v", "error", "-i", str(mp3), "-ss", f"{start:.3f}", "-t", f"{end - start:.3f}",
                    "-c:a", "libmp3lame", "-q:a", "2", "-y", str(dest)], check=True)
    return dest


def cut_audio(mp3: Path, end_s: float, dest: Path) -> Path:
    """The first `end_s` seconds of `mp3` — the intro's audio."""
    return cut_audio_range(mp3, 0.0, end_s, dest)


# ── where the presenter appears ─────────────────────────────────────────────

MIN_GAP_S = 10.0     # at least this much picture between two appearances
TAIL_S = 20.0        # nothing in the last seconds: the ending belongs to the pictures
# A briefing channel wants the presenter back every 40-60 s, which over a 15-minute
# episode is fifteen-odd appearances; the old cap of 6 quietly thinned that to one
# every two and a half minutes and the format stopped reading as presenter-led.
# MIN_GAP_S still decides whether a target can actually be met.
MAX_COUNT = 24


def _ends_sentence(text: str) -> bool:
    return text.rstrip().endswith((".", "!", "?", "…"))


def _sentence_starts(cs: list) -> list:
    """Times where a sentence begins: the first cue, and every cue after one that ended a sentence."""
    out, done = [], True
    for a, _, t in cs:
        if done:
            out.append(a)
        done = _ends_sentence(t)
    return out


def _end_near(cs: list, start: float, want_len: float, max_len: float, window: float = 4.0):
    """The pause that ends a window opening at `start`, as close to `want_len` as the
    speech allows and never longer than `max_len` — cut_point() for a window that
    does not begin at zero. A sentence end first, a plain cue end otherwise."""
    lo, hi, want = start + MIN_SECONDS, start + max_len, start + want_len
    sent = [b for _, b, t in cs if _ends_sentence(t) and lo <= b <= hi]
    plain = [b for _, b, _ in cs if lo <= b <= hi]
    for pool in (sent, plain):
        near = [e for e in pool if abs(e - want) <= window]
        if near:
            return min(near, key=lambda e: abs(e - want))
    before = [e for e in plain if e <= want]
    if before:
        return max(before)
    return min(plain) if plain else None


def plan_windows(srt: Path, total_s: float, count: int, seconds: float,
                 provider: str = DEFAULT_PROVIDER, fps: float = 30.0) -> list:
    """[(start, end), ...] — every stretch the presenter speaks, the intro first.

    The others go at evenly spaced targets between the intro and TAIL_S before the
    end. Each one STARTS where a sentence starts and ENDS where one ends, keeps
    MIN_GAP_S of pictures from the last, and a target that cannot be met is left
    out rather than squeezed in: a presenter who starts mid-sentence reads as a
    glitch. Times sit on the video's frame grid, so the clip, its audio and the
    stretch it replaces are the same frames — over several windows a rounding
    error would otherwise add up until the lips no longer match the voice."""
    cfg = PROVIDERS.get(provider) or PROVIDERS[DEFAULT_PROVIDER]
    seconds = max(MIN_SECONDS, min(float(seconds or 0), MAX_SECONDS))
    grid = lambda t: round(float(t) * fps) / fps
    cs = cues(srt)
    intro_end = grid(max(MIN_SECONDS, cut_point(srt, seconds, max_s=cfg["max_s"])))
    out = [(0.0, intro_end)]
    count = max(1, min(int(count or 1), MAX_COUNT))
    if count == 1 or not cs:
        return out
    starts = _sentence_starts(cs)
    lo, hi = intro_end + MIN_GAP_S, float(total_s) - TAIL_S
    for k in range(1, count):
        if hi <= lo:
            break
        target = lo + (hi - lo) * k / count
        floor = out[-1][1] + MIN_GAP_S
        for st in sorted((x for x in starts if x >= floor), key=lambda x: abs(x - target)):
            end = _end_near(cs, st, seconds, cfg["max_s"])
            if end is not None and end <= hi:
                out.append((grid(st), grid(end)))
                break
    return out


# ── generating the clip ─────────────────────────────────────────────────────

def _kie(provider: str, image_url: str, audio_url: str, dest: Path, log=print) -> Path:
    key = (os.environ.get("KIE_API_KEY") or "").strip()
    if not key:
        raise RuntimeError("KIE_API_KEY missing — needed for the Kling avatar")
    model = "kling/ai-avatar-standard" if provider == "kling-standard" else "kling/ai-avatar-pro"
    hdr = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    base = "https://api.kie.ai/api/v1/jobs"
    r = requests.post(f"{base}/createTask", headers=hdr, timeout=90,
                      json={"model": model, "input": {"image_url": image_url, "audio_url": audio_url,
                                                      "prompt": MOTION_PROMPT}})
    d = r.json()
    # kie answers a refusal with HTTP 200 and a code in the body, so r.ok proves nothing.
    if d.get("code") != 200:
        raise RuntimeError(f"{model}: {d.get('code')} {str(d.get('msg'))[:160]}")
    tid = d["data"]["taskId"]
    t0 = time.time()
    while time.time() - t0 < 1800:
        g = requests.get(f"{base}/recordInfo", headers=hdr, params={"taskId": tid}, timeout=60)
        if g.status_code >= 500:
            time.sleep(5)
            continue
        dd = g.json().get("data", {})
        st = dd.get("state", "")
        if st == "success":
            url = json.loads(dd.get("resultJson", "{}"))["resultUrls"][0]
            # kie publishes no price for these models, but it does say what the run took: a credit is $0.005,
            # so the line below is the real cost of this clip rather than an estimate.
            spent = dd.get("creditsConsumed")
            usd = f" = ${float(spent) * KIE_USD_CREDIT:.3f}" if str(spent or "").replace(".", "", 1).isdigit() else ""
            log(f"    avatar: {PROVIDERS[provider]['label']}, {spent} credits{usd}")
            Path(dest).write_bytes(requests.get(url, timeout=600).content)
            return Path(dest)
        if st == "fail":
            raise RuntimeError(f"{model} failed: {str(dd.get('failMsg'))[:160]}")
        time.sleep(4)
    raise TimeoutError(f"{model}: still not done after 30 min")


def _wavespeed(provider: str, image_url: str, audio_url: str, dest: Path, log=print) -> Path:
    """InfiniteTalk at 480p and 720p is ONE model with a resolution field.

    This used to send the 480p choice to "infinitetalk-fast", a different and
    cheaper model that comes back at 624x352 whatever it is asked for — measured.
    PROVIDERS promised 832x464 at $0.03/s, so the picture was softer and the cost
    line was double what was spent. -fast is not offered at all: 624x352 upscaled
    into a 1080p frame does not pass for a real person."""
    import wavespeed
    payload = {"image": image_url, "audio": audio_url, "prompt": MOTION_PROMPT,
               "resolution": "720p" if provider == "infinitetalk" else "480p"}
    return wavespeed.run("wavespeed-ai/infinitetalk", payload, Path(dest), label="avatar",
                         timeout_s=2400, log=log)


def _who(avatar_id: str):
    """(id, portrait) of the preset — an unknown id falls back to the first one."""
    rows = library()
    row = next((r for r in rows if r["id"] == avatar_id), rows[0] if rows else None)
    if row is None:
        raise FileNotFoundError(f"no avatar library in {LIB_DIR}")
    return row["id"], Path(row["file"])


def _host(path: Path, cache: Path, log=print) -> str:
    """A link the avatar model can read the portrait or the audio from: WaveSpeed's /media/upload, and
    kie's own file hosting when WaveSpeed refuses (it wants credit even to host a file — which stopped
    the presenter of a video whose Kling render on kie was fully paid for)."""
    try:
        import wavespeed
        return wavespeed.upload(path, cache)
    except Exception as e:                                       # noqa: BLE001 - the other host may still take it
        if not (os.environ.get("KIE_API_KEY") or "").strip():
            raise
        import removebg
        kind = {".mp3": "audio/mpeg", ".wav": "audio/wav", ".png": "image/png"}.get(Path(path).suffix.lower(), "image/jpeg")
        log(f"    avatar: WaveSpeed could not host {Path(path).name} ({str(e)[:70]}) — kie hosts it")
        return removebg.kie_upload(Path(path), kind)


def render_window(job: Path, mp3: Path, avatar_id: str, start: float, end: float, idx: int = 1,
                  provider: str = DEFAULT_PROVIDER, force: bool = False, log=print) -> dict:
    """The presenter speaking seconds `start`..`end` of the voiceover.

    Appearance 1 keeps the intro's file names (avatar.mp4 / avatar.json), so jobs
    rendered before appearances existed stay cached; the rest are avatar_2 … avatar_6.
    Returns {"clip", "audio", "start", "end", "cut_s", "avatar", "provider", "usd"}."""
    job = Path(job)
    stem = "avatar" if idx <= 1 else f"avatar_{idx}"
    out, meta_f, aud_f = job / f"{stem}.mp4", job / f"{stem}.json", job / f"{stem}_audio.mp3"
    cfg = PROVIDERS.get(provider) or PROVIDERS[DEFAULT_PROVIDER]
    who, pic = _who(avatar_id)
    if out.exists() and meta_f.exists() and not force:
        try:
            old = json.loads(meta_f.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            old = {}
        o_start = float(old.get("start") or 0.0)
        o_end = float(old.get("end") or old.get("cut_s") or -1)
        # This clip only if it is this face, this service and this stretch — within half a
        # frame, so an intro cut before times sat on the frame grid is still recognised.
        if (old.get("avatar") in (who, avatar_id) and old.get("provider") == provider
                and abs(o_start - start) < 0.02 and abs(o_end - end) < 0.02):
            log(f"cached: {out.name}")
            old.update(clip=str(out), audio=str(aud_f), start=o_start, end=o_end)
            return old
        log(f"avatar: face, service or stretch changed since {out.name} was made — rendering it again")
    log(f"avatar {idx}: {start:.2f}s–{end:.2f}s ({end - start:.1f}s, from a sentence start to a sentence end)")
    aud = cut_audio_range(mp3, start, end, aud_f)
    cache = job / "_uploads.json"
    image_url = _host(pic, cache, log)
    audio_url = _host(aud, cache, log)
    if provider.startswith("kling"):
        try:
            _kie(provider, image_url, audio_url, out, log)
        except (RuntimeError, TimeoutError, requests.RequestException) as e:
            if not (os.environ.get("WAVESPEED_API_KEY") or "").strip():
                raise
            # kie is where the Kling avatar lives; when it has no credit left (or is down) the presenter would
            # take the whole video with it. InfiniteTalk speaks the same seconds for a known price instead.
            log(f"    avatar: kie could not render it ({str(e)[:110]}) — InfiniteTalk 720p takes over")
            provider = "infinitetalk"
            cfg = PROVIDERS[provider]
            _wavespeed(provider, image_url, audio_url, out, log)
    else:
        _wavespeed(provider, image_url, audio_url, out, log)
    length = round(end - start, 3)
    meta = {"clip": str(out), "audio": str(aud), "start": round(start, 3), "end": round(end, 3),
            "cut_s": length, "avatar": who, "provider": provider,
            "usd": round(length * cfg["usd_s"], 3)}
    meta_f.write_text(json.dumps(meta, indent=2), encoding="utf-8")
    log(f"avatar: {out.name} ({length:.1f}s, {cfg['res']}, ~${meta['usd']:.2f})")
    return meta


def render(job: Path, mp3: Path, srt: Path, avatar_id: str, seconds: float,
           provider: str = DEFAULT_PROVIDER, force: bool = False, log=print) -> dict:
    """The intro clip: the presenter speaking from zero to the pause nearest `seconds`."""
    seconds = max(MIN_SECONDS, min(float(seconds or 0), MAX_SECONDS))
    cfg = PROVIDERS.get(provider) or PROVIDERS[DEFAULT_PROVIDER]
    cut_s = round(max(MIN_SECONDS, cut_point(srt, seconds, max_s=cfg["max_s"])), 3)
    log(f"avatar: {seconds:.0f}s asked for, cutting at {cut_s:.2f}s (a pause in the read)")
    return render_window(job, mp3, avatar_id, 0.0, cut_s, 1, provider, force, log)


def _probe(p: Path):
    """(width, height, fps, duration) of a video."""
    probe = os.environ.get("FFPROBE_BIN") or "ffprobe"
    v = subprocess.run([probe, "-v", "error", "-select_streams", "v:0", "-show_entries",
                        "stream=width,height,r_frame_rate", "-of", "csv=p=0:nk=1", str(p)],
                       capture_output=True, text=True).stdout.strip().split(",")
    num, den = (v[2].split("/") + ["1"])[:2]
    dur = float(subprocess.run([probe, "-v", "error", "-show_entries", "format=duration",
                                "-of", "default=nw=1:nk=1", str(p)],
                               capture_output=True, text=True).stdout.strip() or 0)
    return int(v[0]), int(v[1]), float(num) / float(den or 1), dur


def video_fps(p: Path) -> float:
    return _probe(p)[2]


def splice(final: Path, windows: list, dest: Path, log=print) -> Path:
    """Replace the PICTURE of every (clip, start, end) window with that clip.

    The AUDIO is never touched — the finished film keeps its own single take, and
    each clip was lip-synced to exactly its own stretch of it, so there is nothing to
    line up and no join to hear. Whatever was on screen in those seconds — a scene, a
    map, a label, the burnt-in captions — is replaced along with the rest.

    Everything is counted in FRAMES on the video's own grid: the stretches between
    windows come off the film by frame number, and each clip is held on its last frame
    (tpad) and cut to exactly its window's frame count, so a clip a few hundredths
    short cannot pull the rest of the film forward against its voice. Both streams
    are forced to one frame rate, pixel format and set of colour tags before they
    meet — mixing BT.601 and BT.709 in one file has frozen a finishing pass before."""
    final, dest = Path(final), Path(dest)
    ff = os.environ.get("FFMPEG_BIN") or "ffmpeg"
    W, H, FPS, dur = _probe(final)
    fr = lambda t: int(round(float(t) * FPS))
    wins = sorted(((Path(c), fr(s0), fr(s1)) for c, s0, s1 in windows), key=lambda w: w[1])
    total = fr(dur)
    if not wins or wins[-1][2] >= total:
        raise ValueError("a presenter window reaches past the end of the video")
    common = f"fps={FPS:g},format=yuv420p,setsar=1"
    order, stretches, cur = [], [], 0
    for i, (_, a, b) in enumerate(wins):
        if a < cur:
            raise ValueError("presenter windows overlap")
        if a > cur:
            stretches.append((cur, a))
            order.append(("m", len(stretches) - 1))
        order.append(("c", i))
        cur = b
    stretches.append((cur, None))                   # to the true end, last partial frame included
    order.append(("m", len(stretches) - 1))
    fc = [f"[0:v]{common},split={len(stretches)}" + "".join(f"[m{i}]" for i in range(len(stretches)))]
    for i, (a, b) in enumerate(stretches):
        end = f":end_frame={b}" if b is not None else ""
        fc.append(f"[m{i}]trim=start_frame={a}{end},setpts=PTS-STARTPTS,scale={W}:{H}[p{i}]")
    for i, (_, a, b) in enumerate(wins):
        fc.append(f"[{i + 1}:v]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},{common},"
                  f"tpad=stop_mode=clone:stop_duration=2,trim=end_frame={b - a},setpts=PTS-STARTPTS[c{i}]")
    labels = "".join(f"[p{j}]" if k == "m" else f"[c{j}]" for k, j in order)
    fc.append(f"{labels}concat=n={len(order)}:v=1:a=0[v]")
    cmd = [ff, "-v", "error", "-i", str(final)]
    for c, _, _ in wins:
        cmd += ["-i", str(c)]
    cmd += ["-filter_complex", ";".join(fc), "-map", "[v]", "-map", "0:a?",
            "-c:v", "libx264", "-preset", "medium", "-crf", "18",
            "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709",
            "-c:a", "copy", "-movflags", "+faststart", "-y", str(dest)]
    subprocess.run(cmd, check=True)
    got = _probe(dest)[3]
    # ffmpeg exits 0 on a truncated concat, so the length is the only real proof.
    if abs(got - dur) > 1.0:
        raise RuntimeError(f"presenter splice: {dest.name} came out {got:.1f}s, expected {dur:.1f}s")
    spans = ", ".join(f"{a / FPS:.1f}–{b / FPS:.1f}s" for _, a, b in wins)
    log(f"avatar: {len(wins)} appearance(s) in {dest.name} at {spans} ({got:.0f}s total)")
    return dest


def open_with(final: Path, clip: Path, cut_s: float, dest: Path, log=print) -> Path:
    """Put the intro clip on the front of a finished video — splice() with one window at zero."""
    return splice(final, [(clip, 0.0, cut_s)], dest, log)


def cast_text(avatar_id: str) -> str:
    """The presenter, written for the art director so the SAME person shows up in
    the pictures as well as the intro.

    Without this the presenter speaks for eight seconds and then vanishes, and the
    pictures are a stranger's house. With it he is the one kneeling at the shower
    and holding the bottle, which is the only thing that makes the intro feel like
    the start of his video rather than a sticker on the front of someone else's."""
    for r in library():
        if r["id"] == avatar_id and r.get("persona"):
            return (f"THE PRESENTER — the same person in every picture they appear in: "
                    f"{r['persona']}. They are doing the actual work in the scene — kneeling at it, "
                    f"reaching up to it, wiping, holding the product — concentrating on the job and "
                    f"NOT looking at the camera. Copy this description word for word into every prompt "
                    f"they appear in.\n"
                    f"They appear in AT MOST TWO of the scenes, and never twice doing the same thing. "
                    f"Most of the set has nobody in it: a video where every picture is the same man at "
                    f"the same surface is the failure this rule exists to prevent.")
    return ""


def estimate_usd(seconds: float, provider: str = DEFAULT_PROVIDER) -> float:
    """What an intro of this length costs — for the cost line in the UI."""
    cfg = PROVIDERS.get(provider) or PROVIDERS[DEFAULT_PROVIDER]
    return round(max(MIN_SECONDS, min(float(seconds or 0), MAX_SECONDS)) * cfg["usd_s"], 3)
