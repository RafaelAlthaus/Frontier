"""features.py — what a video can be built from: the switches in Options, and the API each one needs.

Every switch is one entry in FEATURES. A channel's style file says which of them it offers and
which are on by default (`"features": {"offered": [...], "on": [...]}`); Options draws exactly
those, ticked, and anyone can untick what they do not want in this video.

`capabilities()` reads `.env` fresh on every call, so a key pasted while Frontier is running shows
up on the next page refresh — and a switch whose API is missing is shown in red with the exact
key to add, instead of failing halfway through a render.
"""

import os
import shutil
from pathlib import Path

HERE = Path(__file__).resolve().parent

FEATURES = [
    {"key": "youtube", "label": "YouTube footage",
     "hint": "real footage of the actual events, people and places — found on YouTube, trimmed to the shot and cropped clear of logos",
     "needs": "youtube"},
    {"key": "stock", "label": "Stock footage",
     "hint": "Pexels b-roll searched for what the narrator is saying",
     "needs": "pexels"},
    {"key": "ai_images", "label": "AI images",
     "hint": "pictures drawn for the exact words they sit on",
     "needs": "images"},
    {"key": "depth", "label": "Depth pop", "parent": "ai_images",
     "hint": "a person or a car in a picture slowly lifts off it while the background pulls back",
     "needs": "wavespeed"},
    {"key": "motion", "label": "Motion graphics",
     "hint": "animated scenes and text labels for the numbers, dates, names and turning points",
     "needs": ""},
    {"key": "vox", "label": "Vox style scenes",
     "hint": "hand-cut paper collage for the people and the key facts, animated like paper on a table",
     "needs": "wavespeed"},
    {"key": "maps", "label": "Map animations",
     "hint": "a real map whenever the voice names a place that matters — routes, pins, regions lifting out",
     "needs": ""},
    {"key": "spotlight", "label": "Photo spotlight",
     "hint": "a real photo of who the voice names; the rest darkens as the camera pushes in",
     "needs": "wavespeed"},
    {"key": "objects", "label": "Real objects",
     "hint": "the products and things the voice names, cut out and flying in with a shadow",
     "needs": "wavespeed"},
    {"key": "headlines", "label": "Newspaper animations",
     "hint": "the real article behind a claim, on screen, the sentence highlighted — three different page moves",
     "needs": ""},
    {"key": "sound", "label": "Sound design",
     "hint": "whooshes, hits and risers under every scene change and animation, kept under the voice",
     "needs": ""},
    {"key": "threed", "label": "3D scenes",
     "hint": "the story rebuilt in real-time 3D — real places, faceless figures, film light — directed, checked and "
             "fixed by Claude before the final render on this computer's graphics card",
     "needs": "gpu", "explicit": True},
    {"key": "avatar", "label": "AI presenter in the intro",
     "hint": "a real-looking person opens the video and speaks the first lines to camera, then it cuts to the pictures",
     "needs": "avatar"},
]
KEYS = [f["key"] for f in FEATURES]
BY_KEY = {f["key"]: f for f in FEATURES}
# switches only a channel that names them offers (3D needs its own style): never on for a channel without a list
EXPLICIT = [f["key"] for f in FEATURES if f.get("explicit")]


def _env() -> dict:
    """The keys as they are right now: the process environment, overlaid with .env read fresh."""
    env = dict(os.environ)
    f = HERE / ".env"
    if f.exists():
        for line in f.read_text(encoding="utf-8", errors="ignore").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            v = v.strip().strip('"').strip("'")
            if v:
                env[k.strip()] = v
    return env


def _has(env: dict, *names) -> bool:
    return any((env.get(n) or "").strip() for n in names)


def _yt_dlp(env: dict) -> bool:
    b = (env.get("YTDLP_BIN") or "").strip()
    if (b and Path(b).exists()) or shutil.which("yt-dlp"):
        return True
    try:
        import yt_dlp  # noqa: F401
        return True
    except ImportError:
        return False


def capabilities() -> dict:
    """{"base": {...}, "features": {key: {"ok": bool, "why": str}}} for the UI and the engine."""
    env = _env()
    claude = bool(shutil.which("claude")) or _has(env, "ANTHROPIC_API_KEY", "KIE_API_KEY")
    voice = _has(env, "ALGROW_API_KEY", "WAVESPEED_API_KEY", "AI33_API_KEY")
    images = _has(env, "ALGROW_API_KEY", "WAVESPEED_API_KEY", "KIE_API_KEY")
    base = {
        "claude": {"ok": claude, "why": "" if claude else
                   "Scripts need Claude: log in to Claude Code, or add ANTHROPIC_API_KEY (or KIE_API_KEY) to .env."},
        "voice": {"ok": voice, "why": "" if voice else
                  "The voiceover needs ALGROW_API_KEY, WAVESPEED_API_KEY or AI33_API_KEY in .env."},
    }
    need = {
        "": (True, ""),
        "pexels": (_has(env, "PEXELS_API_KEY"), "Add PEXELS_API_KEY to .env (free at pexels.com/api)."),
        "images": (images, "Add ALGROW_API_KEY, WAVESPEED_API_KEY or KIE_API_KEY to .env."),
        # cutouts and reference pictures: WaveSpeed, or kie.ai's remover and hosting (removebg.py)
        "wavespeed": (_has(env, "WAVESPEED_API_KEY", "KIE_API_KEY"), "Add WAVESPEED_API_KEY (wavespeed.ai) or KIE_API_KEY (kie.ai) to .env."),
        # the presenter: kie renders the clip, WaveSpeed hosts the picture and the audio for it,
        # so BOTH keys are needed — one of them alone cannot finish the job.
        "avatar": (_has(env, "KIE_API_KEY") and _has(env, "WAVESPEED_API_KEY"),
                   "Add KIE_API_KEY (kie.ai, renders the presenter) and WAVESPEED_API_KEY (wavespeed.ai, hosts the files) to .env."),
    }
    # the watchers youtube.py can ask; the free Gemini tier is the one to recommend first
    yt_key = _has(env, "GEMINI_API_KEY", "OPENLUX_API_KEY", "ALGROW_API_KEY", "WAVESPEED_API_KEY", "KIE_API_KEY")
    if not _yt_dlp(env):
        need["youtube"] = (False, "Install yt-dlp (see README → YouTube footage).")
    else:
        need["youtube"] = (yt_key, "Add GEMINI_API_KEY — free at aistudio.google.com/apikey. "
                                   "OPENLUX_API_KEY, ALGROW_API_KEY, WAVESPEED_API_KEY or KIE_API_KEY work too.")
    # 3D renders with three.js in Playwright's Chromium on this computer's graphics card (never on the render farm)
    three = HERE / "threed" / "render.py"
    try:
        import playwright  # noqa: F401
        pw_ok = True
    except ImportError:
        pw_ok = False
    need["gpu"] = (three.exists() and pw_ok,
                   "The 3D engine needs the threed folder and Playwright (pip install -r requirements.txt, then "
                   "playwright install chromium)." if not pw_ok else "The threed folder is missing — install Frontier again.")
    feats = {}
    for f in FEATURES:
        ok, why = need.get(f["needs"], (True, ""))
        feats[f["key"]] = {"ok": bool(ok), "why": "" if ok else f"API missing — {why}"}
    return {"base": base, "features": feats}


def prices() -> dict:
    """What each switch roughly costs per minute of finished video with the services in .env right now —
    {"voice": {...}, "features": {key: {"per_min": usd, "note": str}}, "picture": usd per AI picture}.
    Estimates for the Options panel, not a bill: the services' own dashboards have the real numbers."""
    env = _env()
    has = lambda *names: _has(env, *names)
    voice = "algrow" if has("ALGROW_API_KEY") else "wavespeed" if has("WAVESPEED_API_KEY") else "ai33" if has("AI33_API_KEY") else ""
    images = "algrow" if has("ALGROW_API_KEY") else "wavespeed" if has("WAVESPEED_API_KEY") else "kie" if has("KIE_API_KEY") else ""
    # Ask the engine which watcher it will actually use rather than guessing a second
    # order here. This used to run its own precedence with Algrow first, so anyone
    # holding an Algrow key was quoted the dearest watcher on the list while the
    # engine quietly used Gemini — the estimate was wrong by more than 10x.
    try:
        import youtube
        watcher = youtube.analyst()
    except Exception:
        watcher = ("gemini" if has("GEMINI_API_KEY") else "openlux" if has("OPENLUX_API_KEY") else
                   "algrow" if has("ALGROW_API_KEY") else "wavespeed" if has("WAVESPEED_API_KEY") else
                   "kie" if has("KIE_API_KEY") else "")
    picture = {"algrow": 0.011, "wavespeed": 0.027, "kie": 0.02}.get(images, 0.02)
    # vox draws on Algrow when there is a key (vox._draw), on WaveSpeed's seedream otherwise
    collage = 0.011 if has("ALGROW_API_KEY") else 0.027 if has("WAVESPEED_API_KEY") else picture
    # Algrow sells ElevenLabs characters at $7.20 per million; a minute of narration is about 900 characters
    v = {"algrow": (0.007, "ElevenLabs on Algrow — about $0.007 a minute ($7.20 per million characters)"),
         "wavespeed": (0.18, "ElevenLabs v3 on WaveSpeed — about $0.18 a minute"),
         # measured: about 1,200 credits a minute of narration, and ai33 sells a million credits for $5
         "ai33": (0.006, "ai33 — about $0.006 a minute (1,200 credits, $5 per million)"), "": (0.0, "no voice service yet")}[voice]
    # What watching really costs, measured on finished films rather than guessed: a full-length documentary has
    # 11-13 minutes of candidate video watched for every minute that ends up on screen (a footage-heavy one, 40).
    # Algrow charges about a credit per 4 minutes watched, so a minute of film costs about $0.10 of watching there;
    # the same work is free on Gemini's daily allowance and pennies on OpenLux. A SHORT test render pays a fixed
    # overhead — it still scans a shelf of candidates — so its real cost per minute is higher than this line.
    yt = {"algrow": (0.10, "a video model watches every candidate video — Algrow, about 1 credit per 4 minutes watched"),
          "gemini": (0.01, "Gemini API watches the candidate videos — free up to 8 hours a day, then cents"),
          "openlux": (0.004, "Gemini through OpenLux watches the candidate videos — a fraction of Google's price"),
          "wavespeed": (0.03, "Gemini on WaveSpeed watches the candidate videos"),
          "kie": (0.03, "Gemini on kie.ai watches the candidate videos"),
          "": (0.0, "")}.get(watcher, (0.03, f"{watcher} watches the candidate videos"))
    feats = {
        "youtube": yt,
        "stock": (0.0, "Pexels — free"),
        "ai_images": (2.5 * picture, f"about ${picture:.3f} a picture on {images or 'your image service'}"),
        "depth": (0.004, "WaveSpeed background remover — $0.004 a picture"),
        "motion": (0.0, "drawn on your computer — free"),
        # vox draws one collage moment per 150 s and never more than six in a film, so a minute of video carries
        # about 1.6 pictures of it — not four (vox.SCENE_EVERY_S)
        "vox": (1.6 * collage, f"about 4 pictures a scene at ${collage:.3f}, one collage every 2.5 minutes, six at most"),
        "maps": (0.0, "drawn on your computer — free"),
        # a photo scene lands at most every 45 s (photofx.EVERY_S), so both of these are well under one a minute
        "spotlight": (0.005, "$0.004 a photo for the cutout, at most one photo scene every 45 seconds"),
        "objects": (0.008, "$0.004 a cutout; a drawn studio photo when no real photo cuts out"),
        "headlines": (0.0, "real pages, captured on your computer — free"),
        "sound": (0.0, "synthesised on your computer — free; the music is yours"),
        # The presenter is billed by the SECOND of intro, not by the length of the
        # film, so a per-minute figure would be nonsense: the same clip costs the
        # same in a 3-minute video and a 30-minute one. `flat` carries it instead.
        "avatar": (0.0, "billed by the length of the intro, not the video"),
        # rendered on this computer's graphics card; Claude directs (one call per ~75 s of 3D) and reviews (3 rounds)
        "threed": (0.0, "rendered on your computer — free; Claude directs and reviews it (Claude Code plan, or about "
                        "$0.40 a minute of 3D on the API)"),
    }
    try:
        import avatar as _avatar
        av_s = _avatar.PROVIDERS[_avatar.DEFAULT_PROVIDER]["usd_s"]
    except Exception:
        av_s = 0.0375
    # kie does not publish a price for the Kling avatar models: this is what a run has cost in practice, and
    # every render logs the credits it really took (a kie credit is $0.005). WaveSpeed's InfiniteTalk, which
    # takes over when kie has no credit left, publishes $0.06 a second at 720p.
    flat = {"avatar": {"per_second": round(av_s, 4),
                       "note": f"about ${av_s:.3f} a second of presenter — a 10-second intro is about "
                               f"${av_s * 10:.2f}; the render log shows what it really cost"}}
    return {"voice": {"per_min": v[0], "note": v[1]}, "picture": picture, "flat": flat,
            "features": {k: {"per_min": round(c, 4), "note": n} for k, (c, n) in feats.items()}}


def resolve(style_info: dict, asked: dict = None) -> dict:
    """The switches for one job: the channel's defaults, overridden by what Options sent, with
    anything the channel does not offer — or whose API is missing — turned off."""
    fcfg = (style_info or {}).get("features") or {}
    # an explicit empty list means none, as the Options panel reads it ("offered": [] — FOLIO draws everything itself);
    # a missing list means every switch
    offered = fcfg.get("offered") if isinstance(fcfg.get("offered"), list) else [k for k in KEYS if k not in EXPLICIT]
    offered = [k for k in offered if k in BY_KEY]
    on = set(fcfg.get("on") if isinstance(fcfg.get("on"), list) else offered)
    caps = capabilities()["features"]
    out = {}
    for k in KEYS:
        want = bool(asked[k]) if isinstance(asked, dict) and k in asked else (k in on)
        out[k] = bool(want and k in offered and caps.get(k, {}).get("ok", True))
    if not out.get("ai_images") and "ai_images" in offered:
        out["depth"] = False            # depth pop lives on AI pictures
    return out
