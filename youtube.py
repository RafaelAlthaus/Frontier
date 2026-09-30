#!/usr/bin/env python3
"""youtube.py — real footage from YouTube in the footage slots, found for the words it sits on.

A documentary shows the real thing: the actual press conference, the factory, the storm, the
match. Stock libraries do not have those; YouTube does. For each ~30 seconds of narration:

    1. need      Claude writes what real footage would show it, and the YouTube search that
                 finds it — names, events, companies, places and years welcome.
    2. search    Algrow's YouTube search (with ALGROW_API_KEY), or yt-dlp's own search (no key).
                 Shorts, reactions, podcasts and very long videos are skipped.
    3. log       a video model watches each candidate and logs every shot in it — times as
                 "MM:SS.s" strings, what it shows, whether it is a presenter, a graphic or has
                 text over it. Algrow and Gemini (GEMINI_API_KEY) take the YouTube link itself;
                 WaveSpeed's and kie's Gemini need the file, so a 360p copy is fetched first.
    4. pick      Claude reads the narration and the shot logs and chooses, for every stretch,
                 the shots that show what is being said — the right person, place and decade.
    5. cut       yt-dlp downloads only those seconds (≤1080p). ffmpeg finds the real cuts so a
                 clip starts and ends inside its shot, crops away black bars and burned-in logos,
                 mutes it and makes it 1920x1080.

The clips land in job/youtube/, tagged with the stretch of narration they were chosen for
(`broll_tags.json`, the same map stock footage uses), so the timeline puts each one under its
own words, for as long as the shot really lasts. Moments used in earlier videos are remembered
in youtube_used.json and not used again.

Try it without making a video:

    python youtube.py search "New Coke press conference 1985"
    python youtube.py shots a8j97dOLsyk

Footage belongs to the people who filmed it. The channel owner decides how it is used — fair use
(commentary, transformation, short excerpts), licences or permission. See README.
"""

import collections
import json
import math
import os
import re
import shlex
import shutil
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import requests

HERE = Path(__file__).resolve().parent
USED = HERE / "youtube_used.json"
W, H, FPS = 1920, 1080, 30

WINDOW_S = float(os.environ.get("YT_WINDOW_S", "30"))    # one need per this much narration
PER_NEED = int(os.environ.get("YT_PER_NEED", "8"))       # shots chosen for each stretch, at most
CANDIDATES = int(os.environ.get("YT_CANDIDATES", "3"))   # videos looked at per search (long ones only where they matter)
# YT_MAX_CANDIDATES caps every channel's look.youtube.candidates — fewer videos watched, less time and credit
MAX_CANDIDATES = int(os.environ.get("YT_MAX_CANDIDATES", "0") or 0)
# a long video is watched where its own words touch the story (focus); a short one whole
FOCUS_WHOLE_S = float(os.environ.get("YT_FOCUS_WHOLE_S", "420"))   # this short or shorter: watched whole
FOCUS_MAX_S = float(os.environ.get("YT_FOCUS_MAX_S", "480"))       # the most of one long video that is watched
MAX_VIDEO_S = int(os.environ.get("YT_MAX_VIDEO_S", "900"))
SHOTS_PER_VIDEO = int(os.environ.get("YT_SHOTS_PER_VIDEO", "22"))   # the most relevant shots of a video Claude reads
WIDE_VIDEOS = int(os.environ.get("YT_WIDE_VIDEOS", "8"))
ARCHIVE_WATCH = int(os.environ.get("YT_ARCHIVE_WATCH", "8"))   # free-licence Archive films watched per video       # watched videos read for a stretch whose own search came up empty
CLIP_MAX_S = 7.0          # the longest a clip runs; a documentary shot rarely holds longer
CLIP_MIN_S = 2.2          # a clean stretch shorter than this is not used
ALGROW = "https://api.algrow.online"
SKIP_WORDS = re.compile(r"#shorts|\breaction\b|\breacts?\b|podcast|\blive ?stream|\bmemes?\b|\basmr\b|lyrics|"
                        r"karaoke|full movie|\bmusic video\b|\btiktok\b|\bprank\b|\bunboxing\b|\bgameplay\b|"
                        # stock libraries' previews carry a watermark across the picture — never usable
                        r"footage ?for ?pro|stock footage|royalty[- ]free|pond5|shutterstock|storyblocks|videoblocks|"
                        r"videvo|envato|artgrid|filmsupply|getty images|critical ?past", re.I)
USABLE_KINDS = ("archive", "news", "modern", "still", "aerial", "nature", "event", "game")
# look.youtube.no_drawn: a channel that takes computer-made shots ("animation") for its reconstructions still never
# takes a DRAWN one — an illustration, an engraving, a cartoon — judged by what the watcher says the shot shows
_DRAWN = re.compile(r"\b(illustrat\w*|drawn|drawings?|sketch\w*|cartoon\w*|engrav\w*|paint(ed|ing|ings)?|"
                    r"watercolou?r|comics?|doodle\w*|hand[- ]drawn|2d|stylized|stylised|clip ?art|infographic\w*|"
                    r"storybook|storyboard|whiteboard|ink|inked|hatch\w*|linework|line art|artwork|art style|"
                    r"motion graphic\w*|diagram\w*|map animation)\b", re.I)
# channels whose uploads are the original footage — studios, platforms, broadcasters, news agencies
OFFICIAL = re.compile(r"^(rockstar games|playstation|xbox|nintendo|ign|gamespot|netflix|bbc news|bbc|cnn|nbc news|abc news|"
                      r"cbs news|pbs newshour|reuters|associated press|ap archive|british path[eé]|the guardian|"
                      r"sky news|al jazeera english|bloomberg television|cnbc|nasa|wall street journal|"
                      r"the new york times|vox|nat geo|national geographic)$", re.I)
_LOCK = threading.Lock()


def _env(name: str) -> str:
    return (os.environ.get(name) or "").strip()


def _log(engine, msg: str) -> None:
    (engine.log if engine is not None else print)(msg)


# ── tools ─────────────────────────────────────────────────────────────────────
def ytdlp() -> list:
    """How to run yt-dlp here, or [] — YTDLP_BIN, then yt-dlp on PATH, then the Python module.

    YouTube hides most formats behind a JavaScript challenge. yt-dlp solves it with deno when deno
    is installed; with only Node.js (or bun) installed it has to be told, so that is added here.

    A long video asks YouTube for hundreds of things in an hour — a search for every window, a file of
    information for every candidate, a section for every clip — and YouTube answers a burst like that with
    "Sign in to confirm you're not a bot". Four settings in .env make the asking polite, and all of them are
    off unless you set them:

        YT_SLEEP=2                  seconds between requests (--sleep-requests)
        YT_WORKERS=2                how many yt-dlp runs at once (the default is 6 to 8)
        YTDLP_COOKIES_FROM_BROWSER=chrome     sign in as yourself, the way yt-dlp itself advises
        YTDLP_COOKIES=/path/cookies.txt       ...or an exported cookies file
        YTDLP_PLAYER_CLIENT=web_safari        last resort: another client, at the cost of resolution
                                              (web_safari 720p, mweb and tv_simply 360p — and anything
                                              under 480 lines is dropped as too small)
        YTDLP_PROXY=http://host:port          your own proxy, if you have one
        YTDLP_ARGS="--force-ipv4"             anything else you want passed through

    Use a spare Google account for the cookies, never the account your channel lives on."""
    b = _env("YTDLP_BIN") or shutil.which("yt-dlp")
    if b:
        cmd = [b]
    else:
        try:
            import yt_dlp  # noqa: F401
            cmd = [sys.executable, "-m", "yt_dlp"]
        except ImportError:
            return []
    if not shutil.which("deno"):
        for rt in ("node", "bun"):
            if shutil.which(rt):
                cmd += ["--js-runtimes", rt]
                break
    if _env("YTDLP_COOKIES_FROM_BROWSER"):
        cmd += ["--cookies-from-browser", _env("YTDLP_COOKIES_FROM_BROWSER")]
    elif _env("YTDLP_COOKIES"):
        cmd += ["--cookies", _env("YTDLP_COOKIES")]
    if _num_env("YT_SLEEP") > 0:
        cmd += ["--sleep-requests", f"{_num_env('YT_SLEEP'):.1f}"]
    if _env("YTDLP_PLAYER_CLIENT"):
        cmd += ["--extractor-args", f"youtube:player_client={_env('YTDLP_PLAYER_CLIENT')}"]
    if _env("YTDLP_PROXY"):
        cmd += ["--proxy", _env("YTDLP_PROXY")]
    if _env("YTDLP_ARGS"):
        cmd += shlex.split(_env("YTDLP_ARGS"))
    return cmd


def _num_env(name: str, default: float = 0.0) -> float:
    try:
        return float(_env(name) or default)
    except ValueError:
        return default


def _pool(default: int) -> int:
    """How many yt-dlp runs may go at once: the step's own number, or the smaller YT_WORKERS when the
    channel's network is being told it looks like a robot."""
    want = int(_num_env("YT_WORKERS", 0))
    return max(1, min(default, want)) if want > 0 else default


def installed() -> bool:
    return bool(ytdlp())


# cheapest first: Google's own Gemini (a free tier covers hours of YouTube a day), then a Gemini relay (OpenLux, a
# fraction of Google's price), then the rest — a watcher that fails (no credit, a quota) hands the video to the next
WATCHERS = (("gemini", "GEMINI_API_KEY"), ("openlux", "OPENLUX_API_KEY"), ("algrow", "ALGROW_API_KEY"),
            ("wavespeed", "WAVESPEED_API_KEY"), ("kie", "KIE_API_KEY"))
_PREFER = {"watcher": "", "kinds": (), "text_ok": (), "no_drawn": False}   # this job's channel: its first watcher (look.youtube.watcher),
# and the shot kinds / on-screen text it may show beyond the defaults (look.youtube.kinds, look.youtube.text_ok)


def _allowed(names: list) -> list:
    """YT_WATCHERS in .env (e.g. "gemini" or "gemini,openlux"): the only video models allowed to watch footage,
    whatever other keys are there. A video none of them can watch is skipped rather than paid for elsewhere."""
    only = [w for w in re.split(r"[\s,]+", (_env("YT_WATCHERS") or "").lower()) if w]
    return [n for n in names if n in only] if only else names


def watchers() -> list:
    """Every video model with a key, the one the channel (or YT_ANALYST) prefers first."""
    have = _allowed([name for name, key in WATCHERS if _env(key)])
    first = (_PREFER["watcher"] or _env("YT_ANALYST")).lower()
    return sorted(have, key=lambda n: n != first)


def analyst() -> str:
    """Which video model logs the footage: the preferred one, else the first whose key is set."""
    got = watchers()
    return got[0] if got else ""


def available() -> bool:
    return installed() and bool(analyst())


def _watch_url(vid: str) -> str:
    """The page a video id names: an "ia:" id is an Internet Archive film, anything else a YouTube video."""
    if str(vid).startswith("ia:"):
        import archiveorg
        return archiveorg.watch_url(vid)
    return f"https://www.youtube.com/watch?v={vid}"


def _safe(vid: str) -> str:
    """A video id as a file name (an Archive id carries the file it names, slashes and all)."""
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", str(vid))[:110]


def _sec(v) -> float:
    """"MM:SS.s" (or H:MM:SS.s, or seconds) -> seconds; -1 when unreadable."""
    if isinstance(v, (int, float)):
        return float(v)
    parts = str(v or "").strip().split(":")
    try:
        if len(parts) == 3:
            return int(parts[0]) * 3600 + int(parts[1]) * 60 + float(parts[2])
        if len(parts) == 2:
            return int(parts[0]) * 60 + float(parts[1])
        return float(parts[0])
    except ValueError:
        return -1.0


def _json_in(text: str):
    m = re.search(r"\{.*\}|\[.*\]", text or "", re.S)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except ValueError:
        # a long log cut off mid-way: keep every complete shot
        shots = re.findall(r"\{[^{}]*\"start\"[^{}]*\}", m.group(0))
        out = []
        for x in shots:
            try:
                out.append(json.loads(x))
            except ValueError:
                pass
        return {"shots": out} if out else None


def _mmss(t: float) -> str:
    return f"{int(t) // 60}:{int(t) % 60:02d}"


# ── 1. what each stretch of narration needs ───────────────────────────────────
NEEDS_PROMPT = """You are the footage researcher for a documentary YouTube video titled "[INSERT TITLE HERE]".
The narration below is cut into windows of about [INSERT WINDOW HERE] seconds. For each window, decide
what REAL footage on YouTube would show what the narrator is talking about in that window, and write
the YouTube search that finds it.

Return ONLY a JSON array, one object per window, in order:
[{"w": 0, "q": "the YouTube search", "q2": "a second, different search", "need": "the shot that should be on screen"}]

- q: 3 to 8 words someone would type into YouTube to find real footage of THIS — in ENGLISH whatever language the
  narration is in (most footage on YouTube is titled in English; a story local to one country may add its own words). Names of people,
  events, companies, products, places and years are welcome and usually necessary:
  "New Coke launch 1985 news", "Chernobyl control room archive footage", "Pepsi bottling plant 1980s".
  Add "footage", "archive", "news report" or "documentary" when that helps. Never a generic stock query.
- q2: a second search for what ELSE this window's sentences name — another person, place, object or event
  in it — so every sentence has footage; if the window has one subject, a wider search for it (the place,
  the company, the era: "Coca-Cola bottling plant 1980s"). Never a rewording of q.
- need: at most 15 words describing the picture: "Roberto Goizueta at a podium announcing New Coke".
- A window about an abstract idea still gets the most concrete real thing near it (the building, the
  product, the place, the person). Only a window that asks the viewer to subscribe or comment gets "q": "".
- Neighbouring windows about the same event may share a q; vary the need so they get different shots.
[INSERT EXTRA HERE]
THE WINDOWS:
[INSERT WINDOWS HERE]"""


def settings(engine, style: str) -> dict:
    """The channel's look.youtube — how finely the narration is searched and how many videos a search watches:
    window_s (one search per this much narration), hook_s + hook_window_s (a finer grid over the opening),
    candidates (videos watched per search) and second_search (false: one search per window). A 30-minute
    documentary watches hundreds of videos on the defaults; wider windows and fewer candidates keep it affordable,
    and each wider window simply gets more shots."""
    look = ((((getattr(engine, "STYLE_INFO", {}) or {}).get(style) or {}).get("look") or {})
            if engine is not None else {})
    raw = look.get("youtube") if isinstance(look.get("youtube"), dict) else {}

    def num(key, default):
        try:
            return float(raw[key]) if raw.get(key) is not None else default
        except (TypeError, ValueError):
            return default
    window = max(10.0, num("window_s", WINDOW_S))
    sources = raw.get("sources")
    sources = [str(x).lower() for x in sources] if isinstance(sources, list) else ["youtube", "archive"]
    return {"window_s": window, "hook_s": max(0.0, num("hook_s", 0.0)),
            "hook_window_s": max(10.0, num("hook_window_s", window)),
            "candidates": max(1, min(int(num("candidates", CANDIDATES)), MAX_CANDIDATES or 10 ** 6)),
            "second_search": raw.get("second_search", True) is not False,
            "watcher": str(raw.get("watcher") or "").strip().lower(),
            # the Internet Archive: free films a monetised channel may show, watched when YouTube came up empty
            "sources": sources, "archive_watch": int(num("archive_watch", ARCHIVE_WATCH)),
            "archive_min_height": int(num("archive_min_height", 480)),
            # a channel ABOUT television may show its anchors and studios ("presenter", "studio") and their
            # own name captions ("lower_third"); every other channel keeps the defaults
            "kinds": tuple(str(x).lower() for x in (raw.get("kinds") or _env("YT_EXTRA_KINDS").split(",")) if str(x).strip()),
            "no_drawn": raw.get("no_drawn") is True,
            "text_ok": tuple(str(x).lower() for x in (raw.get("text_ok") or _env("YT_TEXT_OK").split(",")) if str(x).strip())}


def plan_needs(engine, script: str, job: Path, title: str, force: bool, wpm: float = 0.0, style: str = "") -> list:
    out = job / "youtube" / "needs.json"
    if out.exists() and not force:
        return json.loads(out.read_text(encoding="utf-8"))
    words = (script or "").split()
    if not words:
        return []
    wpm = float(wpm or getattr(engine, "WPM", 140))
    cfg = settings(engine, style)
    # windows of narration: a finer grid over the opening when the channel asks for one
    wins, i, t = [], 0, 0.0
    while i < len(words):
        dur = cfg["hook_window_s"] if t < cfg["hook_s"] else cfg["window_s"]
        per = max(10, int(round(wpm * dur / 60.0)))
        wins.append((i, min(len(words), i + per), t, dur))
        i, t = i + per, t + dur
    n = len(wins)
    chunks = [" ".join(words[a:b]) for a, b, _, _ in wins]
    body = "\n\n".join(f"WINDOW {k} ({_mmss(wins[k][2])}):\n{c[:1400]}" for k, c in enumerate(chunks))
    # the prompt reads "windows of about <grid> seconds"
    grid = (f"{int(cfg['hook_window_s'])} seconds over the first {int(cfg['hook_s'])} seconds, and "
            f"{int(cfg['window_s'])}" if cfg["hook_s"] and cfg["hook_window_s"] != cfg["window_s"]
            else str(int(cfg["window_s"])))
    extra = engine._extra_block() if hasattr(engine, "_extra_block") else ""
    _log(engine, f"Claude: what real footage each of {n} stretches of narration needs...")
    try:
        items = engine._json_items(NEEDS_PROMPT.replace("[INSERT TITLE HERE]", title or "")
                                   .replace("[INSERT WINDOW HERE]", grid)
                                   .replace("[INSERT EXTRA HERE]", extra)
                                   .replace("[INSERT WINDOWS HERE]", body), max_tokens=max(1600, n * 90))
    except SystemExit as e:                  # the engine's JSON helper exits when nothing parses
        _log(engine, f"  footage needs: Claude's answer did not parse — {str(e)[:100]}")
        return []
    # by the window number Claude wrote, not by position: one skipped or merged window must not shift
    # every search after it onto the wrong stretch of narration
    by_w = {}
    for k, it in enumerate(items):
        if not isinstance(it, dict):
            continue
        try:
            w = int(str(it.get("w", k)).lstrip("Ww"))
        except ValueError:
            w = k
        by_w.setdefault(w, it)
    needs = []
    for i in range(n):
        it = by_w.get(i) or {}
        needs.append({"w": i, "t": round(wins[i][2], 1), "dur": wins[i][3], "q": str(it.get("q") or "").strip()[:90],
                      "q2": str(it.get("q2") or "").strip()[:90] if cfg["second_search"] else "",
                      "need": str(it.get("need") or "").strip()[:140], "text": chunks[i][:1400]})
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(needs, indent=1, ensure_ascii=False), encoding="utf-8")
    for x in needs[:8]:
        _log(engine, f"  {_mmss(x['t'])}  {x['q'] or '—'}")
    return needs


# ── 2. search ───────────────────────────────────────────────────────────────
def search(q: str, n: int = 12) -> list:
    """[{id, title, duration, channel}] for a query — Algrow's search, else yt-dlp's."""
    rows = []
    key = _env("ALGROW_API_KEY")
    if key:
        try:
            r = requests.get(f"{ALGROW}/api/search", params={"q": q, "type": "video", "limit": n},
                             headers={"Authorization": f"Bearer {key}"}, timeout=45)
            if r.ok:
                for v in (r.json().get("results") or []):
                    if v.get("type", "video") == "video" and v.get("video_id"):
                        rows.append({"id": v["video_id"], "title": v.get("title") or "",
                                     "duration": float(v.get("duration_seconds") or 0),
                                     "channel": v.get("channel_name") or ""})
        except (requests.RequestException, ValueError):
            rows = []
    if not rows and ytdlp():
        try:
            p = subprocess.run(ytdlp() + ["--flat-playlist", "--no-warnings", "-j", f"ytsearch{n}:{q}"],
                               capture_output=True, text=True, timeout=120)
        except subprocess.TimeoutExpired:
            return []
        for line in p.stdout.splitlines():
            try:
                v = json.loads(line)
            except ValueError:
                continue
            if v.get("id"):
                rows.append({"id": v["id"], "title": v.get("title") or "", "duration": float(v.get("duration") or 0),
                             "channel": v.get("channel") or v.get("uploader") or ""})
    # the two most relevant results may run to half an hour (a studio's full reveal, a long official film);
    # the rest stay short, so watching them stays cheap
    rows = [v for k, v in enumerate(rows) if v["duration"] <= (max(MAX_VIDEO_S, 1800) if k < 2 else MAX_VIDEO_S)]
    # "gameplay" in a title is someone playing with a facecam — unless it is the studio's own trailer or reveal
    rows = [v for v in rows if 25 <= v["duration"] and not (
        SKIP_WORDS.search(v["title"] + " | " + v["channel"]) and not (re.search(r"\bgameplay\b", v["title"], re.I)
                                               and re.search(r"\b(official|trailer|reveal)\b", v["title"], re.I)
                                               and not re.search(r"\b(reaction|reacts?|podcast|live ?stream)\b", v["title"], re.I)))]
    # YouTube's relevance order, but: a teaser under 45 seconds has little to show and goes last; a studio's,
    # broadcaster's or official upload goes before a re-upload; a video under ten minutes before a longer one
    official = lambda v: bool(re.search(r"\bofficial\b", v["title"], re.I)) or bool(OFFICIAL.search(v["channel"]))
    return sorted(rows, key=lambda v: (v["duration"] < 45, not official(v), v["duration"] > 600))


# ── 2b. where a long video is worth watching: its own words ───────────────────────
def _height(vid: str, work: Path) -> int:
    """The tallest picture a video offers (1080, 720, 360...), 0 when unknown."""
    try:
        _source(vid, work)
        d = json.loads((work / "info" / f"{vid}.info.json").read_text(encoding="utf-8"))
        return int(max([f.get("height") or 0 for f in d.get("formats") or []
                        if (f.get("vcodec") or "none") != "none"] + [d.get("height") or 0]))
    except (OSError, ValueError, TypeError):
        return 0


def transcript(vid: str, work: Path, original: bool = False) -> list:
    """[(second, words)] — what a video says, from YouTube's own captions (free: the info file lists them).
    English first when there is any (the shot log reads it); `original` puts the video's own language first,
    so a Czech documentary read as a source keeps its own names and numbers. [] for a video without captions
    (a music-only trailer). Cached in work/transcripts/."""
    out_f = work / "transcripts" / (f"{vid}.orig.json" if original else f"{vid}.json")
    if out_f.exists():
        try:
            return [tuple(x) for x in json.loads(out_f.read_text(encoding="utf-8"))]
        except ValueError:
            pass
    rows = []
    try:
        _source(vid, work)
        d = json.loads((work / "info" / f"{vid}.info.json").read_text(encoding="utf-8"))
        subs, auto, lang = d.get("subtitles") or {}, d.get("automatic_captions") or {}, str(d.get("language") or "")
        order = [(subs, "en"), (auto, "en-orig"), (auto, "en")]
        if lang:
            own = [(subs, lang), (auto, f"{lang}-orig"), (auto, lang)]
            order = own + order if original else order + own
        order += [(auto, k) for k in auto if k.endswith("-orig")] + [(subs, k) for k in subs]
        fmt = None
        for table, key in order:
            fmt = next((f for f in table.get(key) or [] if f.get("ext") == "json3"), None)
            if fmt:
                break
        if fmt:
            r = requests.get(fmt["url"], timeout=30, headers={"User-Agent": "Mozilla/5.0"})
            if r.ok:
                for e in (r.json().get("events") or []):
                    txt = " ".join("".join(x.get("utf8", "") for x in e.get("segs") or []).split())
                    if txt:
                        rows.append((round(float(e.get("tStartMs") or 0) / 1000.0, 1), txt))
    except (OSError, ValueError, requests.RequestException):
        rows = []
    out_f.parent.mkdir(parents=True, exist_ok=True)
    out_f.write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
    return rows


FOCUS_PROMPT = """You decide where to watch long YouTube videos for the footage of a video titled "[INSERT TITLE HERE]".

What the video needs, stretch by stretch:
[INSERT NEEDS HERE]

For each long video below you get its title, its length and what is said in it, twenty seconds at a time. In a
report, a documentary or an essay the pictures follow the words: where it talks about a person, event, place or
thing this video needs, it usually shows it. Choose the stretches of each video worth watching — wherever it
talks about anything this video needs (be generous: a good shot matters more than a minute saved), and its
opening minute when that is a montage of its best footage. Each stretch at least a minute; together at most
[INSERT MAX HERE] minutes of one video. A video that never touches what this video needs gets an empty list.

Return ONLY JSON: [{"id": "V1", "ranges": [["MM:SS", "MM:SS"]]}]

VIDEOS:
[INSERT VIDEOS HERE]"""


def plan_focus(engine, title: str, needs: list, videos: list, work: Path) -> dict:
    """{video id: None (watch it whole) | [[start, end], ...] (watch these stretches) | [] (skip it)}.

    A short video (a trailer, a news report) is watched whole, and so is one without captions. A long one is
    watched where its own words touch what the story needs — Claude reads its transcript — because a 25-minute
    essay may hold two usable minutes, and watching all of it cost twelve times as much. If the plan cannot be
    made, everything is watched whole, as before."""
    plan, long_ = {}, []
    tall = [v for v in videos if float(v.get("duration") or 0) > FOCUS_WHOLE_S]
    for v in videos:
        if v not in tall:
            plan[v["id"]] = None
    with ThreadPoolExecutor(max_workers=6) as ex:          # captions come from each video's info file, side by side
        said = dict(zip([v["id"] for v in tall], ex.map(lambda v: transcript(v["id"], work), tall)))
    for v in tall:
        if len(said.get(v["id"]) or []) < 8:
            plan[v["id"]] = None                   # nothing said to go by: watched whole, as before
            continue
        long_.append((v, said[v["id"]]))
    if not long_:
        return plan
    need_txt = "\n".join(f"- {x.get('need') or x.get('q')}: {str(x.get('text') or '')[:300]}" for x in needs)

    def block(k, v, words):
        buckets = {}
        for t, txt in words:
            buckets.setdefault(int(t // 20), []).append(txt)
        lines = [f"[{_mmss(b * 20)}] {' '.join(' '.join(x).split()[:28])}" for b, x in sorted(buckets.items())]
        return f"V{k} = \"{v['title'][:90]}\" ({v['channel'][:40]}, {_mmss(float(v.get('duration') or 0))})\n" + "\n".join(lines)

    def ask(chunk):
        ids = {f"V{k}": v for k, (v, _w) in enumerate(chunk, 1)}
        prompt = (FOCUS_PROMPT.replace("[INSERT TITLE HERE]", title or "")
                  .replace("[INSERT NEEDS HERE]", need_txt[:6000])
                  .replace("[INSERT MAX HERE]", str(int(FOCUS_MAX_S // 60)))
                  .replace("[INSERT VIDEOS HERE]", "\n\n".join(block(k, v, w) for k, (v, w) in enumerate(chunk, 1))))
        out = {}
        try:
            items = engine._json_items(prompt, max_tokens=1500)
        except (Exception, SystemExit) as e:        # noqa: BLE001 - no plan: those videos are watched whole
            _log(engine, f"  focus: no plan this time — watched whole ({str(e)[:80]})")
            return {v["id"]: None for v, _w in chunk}
        for it in items:
            v = ids.get(str((it or {}).get("id") or "")) if isinstance(it, dict) else None
            if v is None:
                continue
            dur, spans = float(v.get("duration") or 0), []
            for r in it.get("ranges") or []:
                if isinstance(r, (list, tuple)) and len(r) == 2:
                    a, b = _sec(r[0]), _sec(r[1])
                    if 0 <= a < b:
                        spans.append([max(0.0, a - 20.0), min(dur or b + 20.0, b + 20.0)])
            spans.sort()
            merged = []
            for a, b in spans:                       # stretches that touch become one
                if merged and a <= merged[-1][1] + 30.0:
                    merged[-1][1] = max(merged[-1][1], b)
                else:
                    merged.append([a, b])
            kept, total = [], 0.0
            for a, b in merged:                      # the story's own order: the first stretches first
                room = FOCUS_MAX_S - total
                if room < 45.0:
                    break
                b = min(b, a + room)
                kept.append([round(a, 1), round(b, 1)])
                total += b - a
            out[v["id"]] = kept
        for v, _w in chunk:
            out.setdefault(v["id"], None)            # not answered: watched whole
        return out

    chunks = [long_[i:i + 5] for i in range(0, len(long_), 5)]
    with ThreadPoolExecutor(max_workers=3) as ex:
        for part in ex.map(ask, chunks):
            plan.update(part)
    return plan


# ── 3. log every shot of a video ───────────────────────────────────────────────
SHOTS_PROMPT = """You are logging real footage for a documentary. Watch the whole video itself, frame by frame.
ALL TIMES are strings "MM:SS.s" from the start of the video, e.g. "01:07.5" — never plain seconds.

Return ONLY JSON:
{"video": "one line: what this video is", "shots": [{"start": "MM:SS.s", "end": "MM:SS.s", "shows": "precise visual description, at most 20 words; name real people, places, products and years only if certain", "kind": "archive|news|modern|still|aerial|nature|event|game|presenter|interview|studio|graphic|title|screen|drama|animation", "text": "none|small|lower_third|large", "quality": 1-5}]}

Describe only what is on screen: never guess whether footage is official, leaked, fan-made or a concept.
List EVERY distinct shot longer than 1.5 seconds, in order. A new shot starts at every cut, dissolve,
fade or title card.
- kind: archive = old film or video of real events; news = news camera footage; modern = recent real
  footage; still = a photograph or document on screen; presenter = anyone speaking to camera; interview
  = a person being interviewed; studio = a news studio; game = footage of a video game itself (gameplay, an
  official trailer, an in-game cutscene); graphic/animation = other things made on a computer; drama = acted or
  reconstructed; screen = a phone or computer screen recording.
- text: small = a channel logo or date stamp in a corner; lower_third = a name caption; large = titles,
  subtitles or captions over the picture; watermark = a stock library's translucent logo or web address laid
  over the picture anywhere (footageforpro.com, Pond5, Shutterstock, Getty) — look for it in every shot.
- quality: 5 = sharp, steady, well exposed; 1 = unwatchable."""


def _algrow_log(url: str, prompt: str) -> str:
    key = _env("ALGROW_API_KEY")
    h = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    for attempt in range(5):
        r = requests.post(f"{ALGROW}/api/analyze-video", headers=h, timeout=90,
                          json={"video_url": url, "prompt": prompt[:4000], "media_resolution": "low"})
        if r.status_code != 429:
            break
        # Algrow allows 30 requests a minute (status checks included): wait as long as it says, then again
        m = re.search(r"in (\d+)\s*s", r.text or "")
        time.sleep(min(60, int(m.group(1)) + 2) if m else 15 * (attempt + 1))
    if not r.ok:
        raise RuntimeError(f"Algrow analyze-video HTTP {r.status_code}: {r.text[:160]}")
    jid = (r.json() or {}).get("job_id")
    t0 = time.time()
    while time.time() - t0 < 900:
        time.sleep(10)                     # several videos are watched at once; each check counts toward the limit
        try:
            g = requests.get(f"{ALGROW}/api/job-status/{jid}", headers=h, timeout=60).json()
        except (requests.RequestException, ValueError):
            continue
        st = str(g.get("status") or "").lower()
        if st == "completed":
            return g.get("analysis_text") or ""
        if st in ("failed", "error", "cancelled"):
            raise RuntimeError(f"Algrow analysis failed: {str(g.get('error') or g)[:160]}")
    raise RuntimeError("Algrow analysis did not finish in 15 minutes")


# (relay, model) pairs whose daily free allowance ran out during this run — never asked again until the app restarts
_SPENT_TODAY: set = set()
_MISSING: set = set()      # models this key or relay does not have (404)


def _per_day(r) -> bool:
    """A 429 that names a per-day quota: waiting a minute cannot help."""
    return r.status_code == 429 and "PerDay" in (r.text or "")


GEMINI_MODELS = ("gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.5-flash", "gemini-2.5-flash")


OPENLUX_MODELS = ("gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.5-flash-lite", "gemini-2.5-flash")


def _gemini_upload(path: Path, key: str) -> str:
    """A local clip put on Gemini's Files API (free, kept 48 hours) — the only way a model that is not given a
    YouTube link can watch it. Returns the file uri to put in fileData."""
    meta = json.dumps({"file": {"display_name": path.name[:60]}})
    r = requests.post("https://generativelanguage.googleapis.com/upload/v1beta/files",
                      headers={"x-goog-api-key": key, "X-Goog-Upload-Protocol": "multipart"},
                      files={"metadata": (None, meta, "application/json"),
                             "file": (path.name, path.read_bytes(), "video/mp4")}, timeout=1800)
    if not r.ok:
        raise RuntimeError(f"Gemini upload HTTP {r.status_code}: {r.text[:160]}")
    f = (r.json() or {}).get("file") or {}
    name, uri = f.get("name"), f.get("uri")
    if not uri:
        raise RuntimeError(f"Gemini upload returned no file: {str(f)[:160]}")
    # a video is processed before it can be watched
    for _ in range(60):
        if str(f.get("state") or "").upper() == "ACTIVE":
            return uri
        time.sleep(5)
        g = requests.get(f"https://generativelanguage.googleapis.com/v1beta/{name}",
                         headers={"x-goog-api-key": key}, timeout=60)
        f = g.json() if g.ok else f
        if str(f.get("state") or "").upper() == "FAILED":
            raise RuntimeError("Gemini could not process the upload")
    raise TimeoutError("Gemini is still processing the upload")


def _gemini_log(url: str, prompt: str, span: tuple = None, relay: bool = False, file: Path = None) -> str:
    """Google's own Gemini API, which takes a public YouTube link directly (a free tier covers hours of
    video a day) — and only a stretch of it when `span` is given. GEMINI_MODEL picks the model; without it the
    newest Flash that answers is used. `relay`: the same request through OpenLux, which speaks Google's native
    format (OPENLUX_API_KEY, OPENLUX_BASE_URL, OPENLUX_MODEL) at a fraction of the price."""
    if relay:
        key = _env("OPENLUX_API_KEY")
        base = (_env("OPENLUX_BASE_URL") or "https://api.openlux.ai").rstrip("/")
        headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
        models = [_env("OPENLUX_MODEL")] if _env("OPENLUX_MODEL") else list(OPENLUX_MODELS)
    else:
        key = _env("GEMINI_API_KEY")
        base = "https://generativelanguage.googleapis.com"
        headers = {"x-goog-api-key": key}
        models = [_env("GEMINI_MODEL")] if _env("GEMINI_MODEL") else list(GEMINI_MODELS)
    who = "OpenLux" if relay else "Gemini"
    if file is not None:                             # not a YouTube link: the clip itself goes up first
        if relay:
            raise RuntimeError("a relay cannot take an uploaded file — the next watcher takes this one")
        video = {"fileData": {"fileUri": _gemini_upload(file, key), "mimeType": "video/mp4"}}
        span = None                                  # the copy is already cut to the stretch
    else:
        video = {"fileData": {"fileUri": url, "mimeType": "video/*"}}
    if span:
        video["videoMetadata"] = {"startOffset": f"{int(span[0])}s", "endOffset": f"{int(math.ceil(span[1]))}s"}
    body = {"contents": [{"parts": [video, {"text": prompt}]}],
            "generationConfig": {"responseMimeType": "application/json", "temperature": 0.2,
                                 "mediaResolution": "MEDIA_RESOLUTION_LOW"}}
    last = ""
    for i, model in enumerate(models):
        if (relay, model) in _SPENT_TODAY:
            last = f"{model}: today's free allowance is used"
            continue
        # an overloaded model hands over at once while another model is still worth asking; the last one waits
        others = [m for m in models[i + 1:] if (relay, m) not in _SPENT_TODAY and (relay, m) not in _MISSING]
        r = requests.post(f"{base}/v1beta/models/{model}:generateContent", headers=headers, json=body, timeout=900)
        # the free tier counts requests per minute: a "too many" is waited out, not handed to a paid watcher —
        # but a spent DAILY allowance (20 requests per model on a free key) cannot be waited out: that model is
        # left for the rest of the run and the next one, which has its own allowance, is asked at once
        for wait in (25, 55, 90):
            if r.status_code not in (429, 503) or _per_day(r) or (r.status_code == 503 and others):
                break
            time.sleep(wait)
            r = requests.post(f"{base}/v1beta/models/{model}:generateContent", headers=headers, json=body, timeout=900)
        if _per_day(r):
            _SPENT_TODAY.add((relay, model))
            last = f"{model}: today's free allowance is used"
            continue
        if r.status_code == 503:                     # still overloaded after the waits: another model may answer
            last = f"{model}: overloaded"
            continue
        # a model name this key, region or relay does not have: the next one
        if r.status_code == 404 or (r.status_code in (400, 403, 503) and re.search(r"model", r.text or "", re.I)
                                    and re.search(r"not (found|exist|support|available)|no available|invalid model",
                                                  r.text or "", re.I)):
            _MISSING.add((relay, model))
            last = f"{model}: {r.text[:80]}"
            continue
        if not r.ok:
            raise RuntimeError(f"{who} HTTP {r.status_code}: {r.text[:160]}")
        try:
            d = r.json()
        except ValueError:
            raise RuntimeError(f"{who}: answer was not JSON")
        parts = (((d.get("candidates") or [{}])[0].get("content") or {}).get("parts") or [])
        text = "".join(p.get("text", "") for p in parts if not p.get("thought"))
        if not text:                                 # a relay may answer 200 with an error body
            raise RuntimeError(f"{who} said: {str(d.get('error') or d)[:160]}")
        return text
    raise RuntimeError(f"no {who} model answered ({last}) — set {'OPENLUX' if relay else 'GEMINI'}_MODEL in .env")


def _low_copy(vid: str, work: Path, span: tuple = None) -> Path:
    """A small 360p copy (the first 20 minutes at most, or the stretch `span`) for the models that need the file."""
    a, b = (float(span[0]), float(span[1])) if span else (0.0, 1200.0)
    out = work / "low" / (f"{_safe(vid)}_{int(a)}_{int(b)}.mp4" if span else f"{_safe(vid)}.mp4")
    if out.exists():
        return out
    out.parent.mkdir(parents=True, exist_ok=True)
    if str(vid).startswith("ia:"):
        # an Archive film is one big file with no small format of its own — yt-dlp would fetch all 200 MB of it.
        # ffmpeg reads the stretch straight off the URL instead and writes a copy small enough to upload: ten
        # minutes at 360p and 10 frames a second is about 20 MB, and a shot log needs nothing more.
        b = min(b, a + 600.0)
        try:
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-rw_timeout", "20000000", "-ss", f"{a:.1f}",
                            "-i", _watch_url(vid), "-t", f"{b - a:.1f}", "-vf", "scale=-2:360", "-r", "10",
                            "-c:v", "libx264", "-crf", "30", "-preset", "veryfast", "-c:a", "aac", "-b:a", "48k",
                            "-ac", "1", str(out)], capture_output=True, text=True, timeout=600)
        except subprocess.TimeoutExpired:                      # a film the Archive serves too slowly to wait for
            if out.exists():
                out.unlink()
            raise RuntimeError(f"{vid} came down too slowly to watch")
        if out.exists() and out.stat().st_size > 10000:
            return out
        if out.exists():
            out.unlink()
        raise RuntimeError(f"could not fetch a small copy of {vid}")
    subprocess.run(ytdlp() + ["-q", "--no-warnings", "-f", "bv*[height<=360]+ba/b[height<=360]/worst",
                              "--download-sections", f"*{a:.1f}-{b:.1f}", "--force-keyframes-at-cuts",
                              "--merge-output-format", "mp4",
                              "-o", str(out.with_suffix("")) + ".%(ext)s", _watch_url(vid)],
                   capture_output=True, text=True, timeout=900)
    if not out.exists():
        raise RuntimeError(f"could not fetch a 360p copy of {vid}")
    return out


def _chat_log(endpoint: str, key: str, model: str, part: dict, prompt: str) -> str:
    body = {"messages": [{"role": "user", "content": [part, {"type": "text", "text": prompt}]}],
            "temperature": 0.2, "max_tokens": 12000}
    if model:
        body["model"] = model
    r = requests.post(endpoint, headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                      json=body, timeout=900)
    if not r.ok:
        raise RuntimeError(f"{endpoint.split('/')[2]} HTTP {r.status_code}: {r.text[:160]}")
    # some gateways answer 200 with an error body ({"code": 500, "msg": "..."}): that is a failure, not an
    # empty log — raising it lets the caller try again or hand the video to the next model
    try:
        d = r.json()
    except ValueError:
        raise RuntimeError(f"{endpoint.split('/')[2]}: answer was not JSON")
    text = ((d.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
    if not text:
        why = str(d.get("msg") or d.get("error") or d)[:160]
        raise RuntimeError(f"{endpoint.split('/')[2]} said: {why}")
    return text


def _wavespeed_log(vid: str, prompt: str, work: Path, span: tuple = None) -> str:
    import wavespeed
    url = wavespeed.upload(_low_copy(vid, work, span), work / "uploads.json")
    return _chat_log("https://llm.wavespeed.ai/v1/chat/completions", _env("WAVESPEED_API_KEY"),
                     _env("WAVESPEED_GEMINI_MODEL") or "google/gemini-3.7-flash",
                     {"type": "video_url", "video_url": {"url": url}}, prompt)


def _kie_upload(path: Path) -> str:
    with open(path, "rb") as fh:
        r = requests.post("https://kieai.redpandaai.co/api/file-stream-upload",
                          headers={"Authorization": f"Bearer {_env('KIE_API_KEY')}"},
                          data={"uploadPath": "frontier", "fileName": path.name},
                          files={"file": (path.name, fh, "video/mp4")}, timeout=900)
    r.raise_for_status()
    d = (r.json() or {}).get("data") or {}
    url = d.get("downloadUrl") or d.get("fileUrl") or d.get("url")
    if not url:
        raise RuntimeError(f"kie upload returned no URL: {r.text[:160]}")
    return url


def _kie_log(vid: str, prompt: str, work: Path, span: tuple = None) -> str:
    # kie's gateway answers a busy minute with {"code": 500, "msg": "Network error, please try again later."}.
    # The upload is the slow part, so it is done once and only the watching is tried again.
    url = _kie_upload(_low_copy(vid, work, span))
    last = None
    for wait in (0, 20, 60):
        if wait:
            time.sleep(wait)
        try:
            return _chat_log("https://api.kie.ai/gemini-2.5-flash/v1/chat/completions", _env("KIE_API_KEY"), "",
                             {"type": "image_url", "image_url": {"url": url}}, prompt)
        except RuntimeError as e:                               # noqa: PERF203 - three tries, then the next model
            last = e
            if "HTTP 4" in str(e):
                break
    raise last


def focus_analysts() -> list:
    """The video models that can watch a stretch of a video, best first (Algrow takes whole YouTube links only).
    YT_FOCUS_ANALYST puts one first."""
    have = [n for n, key in (("gemini", "GEMINI_API_KEY"), ("openlux", "OPENLUX_API_KEY"), ("wavespeed", "WAVESPEED_API_KEY"),
                             ("kie", "KIE_API_KEY"))
            if _env(key)]
    have = _allowed(have)
    first = (_env("YT_FOCUS_ANALYST") or _PREFER["watcher"]).lower()
    return sorted(have, key=lambda n: n != first)


def _log_one(vid: str, work: Path, prompt: str, span: tuple = None) -> dict:
    url = _watch_url(vid)
    text, last = None, None
    # a stretch goes to a model that can watch just that stretch; a whole video to the preferred watcher — and when
    # one fails (no credit left, a timeout), the next model with a key takes over
    for who in (focus_analysts() if span else watchers()):
        try:
            if who == "algrow":
                if "youtube.com" not in url:         # Algrow watches YouTube links only
                    raise RuntimeError("not a YouTube link — the next watcher takes this one")
                text = _algrow_log(url, prompt)
            elif who == "gemini":
                # only YouTube can be watched by its link; an Archive film is uploaded (free) instead
                if "youtube.com" not in url:
                    text = _gemini_log(url, prompt, span, file=_low_copy(vid, work, span))
                else:
                    try:
                        text = _gemini_log(url, prompt, span)
                    except RuntimeError as e:
                        # some videos are closed to the API (age gate, embedding off): "403 PERMISSION_DENIED".
                        # A 360p copy of them is uploaded instead, which costs nothing but the download.
                        if "403" not in str(e) and "PERMISSION_DENIED" not in str(e):
                            raise
                        text = _gemini_log(url, prompt, span, file=_low_copy(vid, work, span))
            elif who == "openlux":
                text = _gemini_log(url, prompt, span, relay=True)
            elif who == "wavespeed":
                text = _wavespeed_log(vid, prompt, work, span)
            elif who == "kie":
                text = _kie_log(vid, prompt, work, span)
            break
        except Exception as e:                                  # noqa: BLE001 - the next model may still answer
            last = e
    if text is None:
        raise last or RuntimeError("no video model key (ALGROW_API_KEY, GEMINI_API_KEY, WAVESPEED_API_KEY or KIE_API_KEY)")
    data = _json_in(text)
    if isinstance(data, list):
        data = {"shots": data}
    if not isinstance(data, dict) or not data.get("shots"):
        raise RuntimeError(f"the shot log did not parse: {text[:120]}")
    return data


def can_focus() -> bool:
    """Whether a stretch of a long video can be watched on its own (a Gemini, WaveSpeed or kie key)."""
    return bool(focus_analysts())


def shots(vid: str, work: Path, spans: list = None) -> dict:
    """{"video": str, "shots": [{start, end, shows, kind, text, quality}]} — the shot log of one video (or of
    the stretches `spans` of it, each watched on its own and put back on the video's clock), cached in
    work/catalog/. The log does not depend on the story, so it is made once."""
    cat = work / "catalog" / f"{_safe(vid)}.json"
    if cat.exists():
        try:
            return json.loads(cat.read_text(encoding="utf-8"))
        except ValueError:
            pass
    # YT_CACHED_ONLY=1: build the video out of the shot logs already on disk and never pay a video
    # model for a new one — for finishing a render when the credit for watching has run out
    if _env("YT_CACHED_ONLY") in ("1", "true", "yes", "on"):
        raise RuntimeError("not watched: only the videos already in the catalog are used (YT_CACHED_ONLY)")
    if not spans or not can_focus():
        data = _log_one(vid, work, SHOTS_PROMPT)
    else:
        def stretch(span):
            a, b = span
            got, summary, reach, tries = [], "", a, 0
            # a model can stop logging before the clip ends: the part it left out is watched once more
            while b - reach >= 8.0 and tries < 2:
                tries += 1
                a1 = max(a, reach - 1.0) if got else a
                part = _log_one(vid, work, SHOTS_PROMPT.replace(
                    "Watch the whole video itself, frame by frame.",
                    f"This clip is {_mmss(b - a1)} long, cut from a longer video. Watch all of it to its very last "
                    f"second, frame by frame.").replace("from the start of the video", "from the start of THIS CLIP"),
                    (a1, b))
                rows = [x for x in part.get("shots") or [] if isinstance(x, dict)]
                starts = [_sec(x.get("start")) for x in rows]
                # a model may still answer on the whole video's clock: the reading that puts the shots inside the stretch wins
                inside = lambda off: sum(1 for t in starts if a1 - 3 <= t + off <= b + 3)
                off = a1 if inside(a1) >= inside(0.0) else 0.0
                ends = []
                for x in rows:
                    s0, e0 = _sec(x.get("start")) + off, _sec(x.get("end")) + off
                    if s0 < 0 or e0 <= s0 or (got and s0 < reach - 1.0):
                        continue
                    got.append(dict(x, start=_clock(s0), end=_clock(min(e0, b))))
                    ends.append(e0)
                summary = summary or str(part.get("video") or "")
                if not ends:
                    break
                reach = max(ends)
            return got, summary

        data = {"video": "", "shots": [], "spans": spans}
        with ThreadPoolExecutor(max_workers=min(3, len(spans))) as ex:
            for got, summary in ex.map(stretch, spans):
                data["shots"] += got
                data["video"] = data["video"] or summary
        data["shots"].sort(key=lambda x: _sec(x.get("start")))
        for f in (work / "low").glob(f"{_safe(vid)}_*.mp4") if (work / "low").is_dir() else []:
            f.unlink(missing_ok=True)
        if not data["shots"]:
            raise RuntimeError("no shot in the watched stretches")
    cat.parent.mkdir(parents=True, exist_ok=True)
    # an Archive id holds a slash and a space, and the file it is cached in cannot: the id itself is written
    # inside, so a later job reading the catalogue back knows what to ask yt-dlp for
    data["id"] = vid
    cat.write_text(json.dumps(data, indent=1, ensure_ascii=False), encoding="utf-8")
    low = work / "low" / f"{_safe(vid)}.mp4"
    if low.exists():
        low.unlink()
    return data


def _clock(t: float) -> str:
    return f"{int(t) // 60:02d}:{t - (int(t) // 60) * 60:04.1f}"


_GAME = re.compile(r"\b(game ?play|in-game|video ?game|trailer|cutscene|gta|grand theft auto|rockstar|playstation|xbox|"
                   r"leonida|vice city|los santos|red dead)\b", re.I)


def usable(log: dict, title: str = "") -> list:
    """The shots a documentary can show: real footage, no presenter, no big text, long enough — and a video
    game's own footage (logs made before the "game" kind called it animation: a game video's animation is
    the game)."""
    out = []
    about = f"{title} {log.get('video') or ''}"
    game_video = bool(_GAME.search(about))
    # a fan's concept trailer or a mod is not the game — judged by the video's real title and channel (the shot
    # log's own one-line summary calls an official cinematic trailer "conceptual" often enough)
    not_real = bool(title) and bool(re.search(r"\b(concept|fan[- ]?made|fanmade|unofficial|recreat\w*|remake|mods?|fake|"
                                              r"ai[- ]generated|what if)\b", title, re.I))
    for i, s in enumerate(log.get("shots") or []):
        if not isinstance(s, dict):
            continue
        a, b = _sec(s.get("start")), _sec(s.get("end"))
        kind = str(s.get("kind") or "").lower()
        if kind == "animation" and game_video:
            kind = "game"
        if kind == "game" and not_real:
            continue
        text = str(s.get("text") or "none").lower()
        try:
            q = float(s.get("quality") or 3)
        except (TypeError, ValueError):
            q = 3.0
        if _PREFER.get("no_drawn") and kind in ("animation", "graphic", "still") and _DRAWN.search(str(s.get("shows") or "")):
            continue
        if (a < 0 or b - a < CLIP_MIN_S + 0.3 or kind not in USABLE_KINDS + tuple(_PREFER.get("kinds") or ())
                or text not in ("none", "small") + tuple(_PREFER.get("text_ok") or ()) or q < 3):
            continue
        out.append({"i": i, "start": a, "end": b, "shows": str(s.get("shows") or "")[:160], "kind": kind,
                    "text": text})
    return out


# ── 4. Claude chooses the shots ────────────────────────────────────────────────
PICK_PROMPT = """You are the editor of a documentary YouTube video titled "[INSERT TITLE HERE]". Below are
stretches of its narration and a log of real footage shots found on YouTube for them.

Edit the footage sentence by sentence: for every window, choose up to [INSERT N HERE] shots, each for the ONE
sentence of that window whose words it shows on screen — the viewer should see what they are hearing.
- A shot must show the actual person, place, event, object or era the words are about; failing that,
  something unmistakably about the same moment of the story. Sharing a brand name or a city is not
  enough: a stunt on a company's sign does not illustrate its market share. Never a shot that
  contradicts the words: the wrong country, the wrong decade, a different person, a different product.
- Every shot id is used at most once in the whole answer. Shots that seem to show the same photograph,
  document or moment count as one shot: choose only one of them. Picks for one window should differ
  from each other (a wide shot, a close shot, a different subject).
- This edit cuts every [INSERT CUT HERE] seconds: when the log has shots that fit, give each window at
  least [INSERT MIN HERE]. A sentence can get two or three shots in a row; a sentence nothing in the log shows gets none.
- Fewer shots, or none, is better than a poor match: moments without footage get maps, photos and graphics.
- Between two shots that show the same thing equally well, take the one from the sharper video (the p number).
- A sentence about the video's main subject that nothing in the log shows (a rumour, a private moment, a
  statement) may get a plain shot of that subject from the same period — never one tied to a different, dated
  event (a 2024 trophy ceremony under a 2026 sentence), and never a shot that shows another named person.
- Video game footage (kind game) only when the narration is about that game — then it is the best footage there is.
  For a game not yet released, only the studio's own trailers and footage are real (and news reports showing
  them): another channel's "gameplay trailer", "concept" or "leaked gameplay" of it is fan-made or leaked — never.
[INSERT EXTRA HERE]
Return ONLY a JSON array, the shots of each window in the order they should play:
[{"w": <window number>, "shots": [{"id": "V2.7", "line": "the first 3 to 6 words of the sentence it shows, copied exactly"}]}]

WINDOWS:
[INSERT WINDOWS HERE]

SHOTS (id | seconds | kind | what it shows):
[INSERT SHOTS HERE]"""


def _pick(engine, title: str, needs: list, videos: list, cut_s: float = 4.0) -> list:
    """[(need, vid, start, end, text, line)] — Claude's choice for one batch of windows."""
    ids, lines = {}, []
    # a full race broadcast logs hundreds of shots: Claude reads the ones whose words touch this stretch
    words = lambda t: {w for w in re.findall(r"[a-z0-9]+", str(t).lower()) if len(w) > 3}
    want = words(" ".join(f"{x.get('text', '')} {x.get('need', '')} {x.get('q', '')} {x.get('q2', '')}" for x in needs))
    guess = re.compile(r"\b(fan[- ]?made|conceptual|concept|unofficial|fake)\s*", re.I)
    for k, v in enumerate(videos, 1):
        lines.append(f'V{k} = "{v["title"][:90]}" ({v["channel"][:40]}{", " + str(v["height"]) + "p" if v.get("height") else ""})')
        shots_ = sorted(v["usable"], key=lambda s_: (-len(words(s_["shows"]) & want), s_["start"]))[:SHOTS_PER_VIDEO]
        official = bool(OFFICIAL.search(v.get("channel") or ""))
        for s in sorted(shots_, key=lambda s_: s_["start"]):
            sid = f"V{k}.{s['i']}"
            ids[sid] = (v["id"], s["start"], s["end"], s.get("text", "none"))
            # the video model guesses "fan-made concept" for a studio's own unreleased-game trailer: from the
            # studio's channel that guess is noise, and it made Claude skip the best footage there was
            shows = guess.sub("", s["shows"]) if official else s["shows"]
            lines.append(f"{sid} | {s['end'] - s['start']:.1f}s | {s['kind']} | {shows}")
    if not ids:
        return []
    wins = "\n".join(f"W{x['w']} ({_mmss(x['t'])}) — footage wanted: {x['need'] or x['q']}\n  narration: {x['text'][:1400]}"
                     for x in needs)
    extra = engine._extra_block() if hasattr(engine, "_extra_block") else ""
    span = max(float(x.get("dur") or WINDOW_S) for x in needs)      # a wider window gets more shots
    per = max(PER_NEED, int(round(span / max(1.5, cut_s) * 1.2)))
    prompt = (PICK_PROMPT.replace("[INSERT TITLE HERE]", title or "").replace("[INSERT N HERE]", str(per))
              .replace("[INSERT CUT HERE]", f"{max(1.5, cut_s - 1):.0f} to {cut_s + 1:.0f}")
              .replace("[INSERT MIN HERE]", str(max(4, int(span / (cut_s + 1)))))
              .replace("[INSERT EXTRA HERE]", extra).replace("[INSERT WINDOWS HERE]", wins)
              .replace("[INSERT SHOTS HERE]", "\n".join(lines)))
    try:
        items = engine._json_items(prompt, max_tokens=max(1200, len(needs) * 120))
    except SystemExit as e:
        _log(engine, f"  footage picks did not parse — {str(e)[:100]}")
        return []
    by_w = {x["w"]: x for x in needs}
    out, taken = [], set()
    for it in items:
        if not isinstance(it, dict):
            continue
        try:
            need = by_w.get(int(str(it.get("w")).lstrip("Wmw")))
        except ValueError:
            continue
        if need is None:
            continue
        for sh in (it.get("shots") or [])[:per]:
            sid = str(sh.get("id") if isinstance(sh, dict) else sh).strip()
            line = str(sh.get("line") or "")[:80] if isinstance(sh, dict) else ""
            if sid in ids and sid not in taken:
                taken.add(sid)
                out.append((need,) + ids[sid] + (line,))
    return out


# ── 5. cut a clean clip ────────────────────────────────────────────────────────
def _probe(path: Path) -> tuple:
    p = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                        "stream=width,height:format=duration", "-of", "json", str(path)], capture_output=True, text=True)
    try:
        j = json.loads(p.stdout or "{}")
    except ValueError:
        return 0, 0, 0.0
    s = (j.get("streams") or [{}])[0]
    return int(s.get("width") or 0), int(s.get("height") or 0), float((j.get("format") or {}).get("duration") or 0)


def _cuts(path: Path) -> list:
    """Cuts, dissolves and fades in a section, as (first, last) second spans.

    A frame that looks nothing like the frame two before it — while the frames around it look like
    their neighbours — is a cut. Comparing across two frames catches the short dissolves news footage
    is full of, which a frame-to-frame scene score misses entirely. Going to or from black counts too."""
    size = 96 * 54
    p = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-an", "-vf", "fps=30,scale=96:54,format=gray",
                        "-f", "rawvideo", "-"], capture_output=True)
    if len(p.stdout) < size * 6:
        return []
    f = np.frombuffer(p.stdout[: len(p.stdout) // size * size], np.uint8).reshape(-1, size).astype(np.float32)
    n = len(f)
    lum = f.mean(1)
    # pixels that never change — black bars, a burned-in logo — look the same across any cut and hide it
    live = f.std(0) > 2.0
    g = f[:, live] if live.sum() > size * 0.1 else f
    x = g - g.mean(1)[:, None]
    nrm = np.linalg.norm(x, axis=1) + 1e-3
    c = np.ones(n)
    c[2:] = (x[2:] * x[:-2]).sum(1) / (nrm[2:] * nrm[:-2])
    # grainy archive film never correlates as well as a clean digital shot: both thresholds follow the section's
    # own level, so a noisy transfer is not read as a cut every second (and clean footage keeps the old numbers)
    med = float(np.median(c[2:])) if n > 2 else 1.0
    thr = min(0.6, med * 0.85)
    drop = max(0.2, (1.0 - med) * 0.55)
    marks = [i for i in range(2, n)
             if c[i] < thr and c[i] < float(np.median(c[max(2, i - 12):min(n, i + 12)])) - drop]
    dark = lum < 18
    marks += [i for i in range(1, n) if dark[i] != dark[i - 1]]
    # A slow dissolve changes the picture too gently for either test. Inside one, a frame is a mix
    # of the frames a third of a second before and after it — two pictures that are not alike —
    # which camera motion inside a single shot never is.
    # A pan fits that loosely too, so a dissolve must also look like one over time: the two pictures
    # really differ, the mix is close, and the old picture's share falls while the new one's rises.
    k, soft, share = 10, [], {}
    for i in range(k, n - k):
        a0, b0, c0 = x[i - k], x[i + k], x[i]
        if float(a0 @ b0) / (nrm[i - k] * nrm[i + k]) > 0.5:
            continue
        m = np.array([[a0 @ a0, a0 @ b0], [a0 @ b0, b0 @ b0]], dtype=np.float64)
        w = np.linalg.lstsq(m, np.array([a0 @ c0, b0 @ c0], dtype=np.float64), rcond=None)[0]
        if 0.15 < w[0] < 0.85 and 0.15 < w[1] < 0.85 and \
                float(np.linalg.norm(c0 - w[0] * a0 - w[1] * b0)) < 0.45 * float(nrm[i]):
            soft.append(i)
            share[i] = float(w[0])
    runs = []
    for i in soft:
        if runs and i - runs[-1][1] <= 1:
            runs[-1][1] = i
        else:
            runs.append([i, i])
    for a, b in runs:
        if b - a >= 3 and share[a] - share[b] > 0.12:     # lasts, and hands over from old to new
            marks += list(range(max(0, a - k // 2), min(n, b + k // 2 + 1)))
    spans = []
    for i in sorted(set(marks)):
        if spans and i - spans[-1][1] <= 3:
            spans[-1][1] = i
        else:
            spans.append([i, i])
    return [((a - 2) / 30.0, b / 30.0) for a, b in spans]


def _active(path: Path, w: int, h: int, s: float, length: float) -> tuple:
    """The picture inside any pillarbox or letterbox bars, over the part of the section that is used."""
    p = subprocess.run(["ffmpeg", "-hide_banner", "-ss", f"{s:.2f}", "-t", f"{length:.2f}", "-i", str(path),
                        "-vf", "cropdetect=limit=28:round=2:reset=0", "-f", "null", "-"], capture_output=True, text=True)
    m = re.findall(r"crop=(\d+):(\d+):(\d+):(\d+)", p.stderr)
    if m:
        cw, ch, cx, cy = map(int, m[-1])
        if cw > w * 0.5 and ch > h * 0.5:
            return cw, ch, cx, cy
    return w, h, 0, 0


def _window(path: Path, a: float, b: float, area: tuple, dur: float = 0.0, logo: bool = False) -> tuple:
    """The least-zoomed 16:9 window inside the picture that clears burned-in logos and tickers:
    pixels that stay put while the picture changes and carry hard edges, near the borders. Frames
    come from the whole section — its padding usually holds the shots either side, so a channel logo
    is the one thing that never changes even when the shot itself is still. A still shot the log says
    has a logo, with nothing else to tell it apart, is pushed in far enough to lose the corners."""
    aw, ah, ax, ay = area
    base_w = min(aw, ah * 16 / 9)
    base_h = base_w * 9 / 16
    frames = []
    times = list(np.linspace(a + 0.1, max(a + 0.2, b - 0.1), 8))
    if dur > b - a + 0.5:
        times += list(np.linspace(0.05, max(0.1, dur - 0.1), 8))
    for t in times:
        p = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{t:.2f}", "-i", str(path), "-frames:v", "1", "-vf",
                            f"crop={aw}:{ah}:{ax}:{ay},scale=240:{max(2, int(round(240 * ah / aw / 2)) * 2)},format=gray",
                            "-f", "rawvideo", "-"], capture_output=True)
        if p.stdout:
            frames.append(p.stdout)
    moved = False
    if len(frames) >= 4 and len(set(len(x) for x in frames)) == 1 and len(frames[0]) % 240 == 0:
        hh = len(frames[0]) // 240
        f = np.stack([np.frombuffer(x, np.uint8).reshape(hh, 240) for x in frames]).astype(np.float32)
        moved = float(f.std(0).mean()) > 3.0
        if moved:                                   # a picture that changes: static edges are overlays
            mean = f.mean(0)
            edges = np.maximum(np.abs(np.diff(mean, axis=1, prepend=mean[:, :1])),
                               np.abs(np.diff(mean, axis=0, prepend=mean[:1])))
            mask = (f.std(0) < 4.0) & (edges > 24)
            if logo:
                # a translucent channel bug changes brightness with the picture under it, so it is not still —
                # but its outline stays put in nearly every frame while the picture's edges move on
                g = np.maximum(np.abs(np.diff(f, axis=2, prepend=f[:, :, :1])), np.abs(np.diff(f, axis=1, prepend=f[:, :1, :])))
                mask |= (g > 16).mean(0) >= 0.85
            border = np.zeros_like(mask)
            border[: int(hh * 0.2)], border[int(hh * 0.8):] = True, True
            border[:, :29], border[:, 211:] = True, True
            mask &= border
            ii = np.pad(mask.astype(np.int32).cumsum(0).cumsum(1), ((1, 0), (1, 0)))

            def hits(x0, y0, x1, y1):
                c0, r0 = int(x0 * 240 / aw), int(y0 * hh / ah)
                c1, r1 = min(240, int(math.ceil(x1 * 240 / aw))), min(hh, int(math.ceil(y1 * hh / ah)))
                return int(ii[r1, c1] - ii[r0, c1] - ii[r1, c0] + ii[r0, c0])
            if hits(0, 0, aw, ah) > 2:
                for z in np.arange(1.0, 1.46, 0.025):
                    cw, ch = base_w / z, base_h / z
                    best = None
                    for fy in np.linspace(0, 1, 17):
                        for fx in np.linspace(0, 1, 17):
                            x0, y0 = (aw - cw) * fx, (ah - ch) * fy
                            if hits(x0, y0, x0 + cw, y0 + ch) <= 2:
                                off = abs(fx - 0.5) + abs(fy - 0.42) * 1.2
                                if best is None or off < best[0]:
                                    best = (off, x0, y0)
                    if best:
                        return int(cw) // 2 * 2, int(ch) // 2 * 2, int(ax + best[1]), int(ay + best[2])
    if logo:
        # the log saw a logo the edges did not show — a translucent channel bug, a watermark over moving
        # footage: a still shot is pushed in far enough to lose the corners, a moving one a little less
        z = 1.24 if moved else 1.28
        cw, ch = base_w / z, base_h / z
        return int(cw) // 2 * 2, int(ch) // 2 * 2, int(ax + (aw - cw) / 2), int(ay + (ah - ch) * 0.45)
    return int(base_w) // 2 * 2, int(base_h) // 2 * 2, int(ax + (aw - base_w) / 2), int(ay + (ah - base_h) * 0.42)


_INFO_LOCKS: dict = {}


_YTDLP_ERR: list = []       # the first error yt-dlp printed in this run's cutting


def _note_err(stderr: str) -> None:
    """Keep yt-dlp's first ERROR line: when YouTube refuses every download ("Sign in to confirm you're not a bot"),
    the summary otherwise blamed the shots ("29 without a clean 2.2s") and nobody knew to fix the access."""
    line = next((ln.strip() for ln in (stderr or "").splitlines() if "ERROR" in ln), "")
    if line and not _YTDLP_ERR:
        _YTDLP_ERR.append(line[:240])


def last_error() -> str:
    """What yt-dlp said when this run's clips would not download, with the setting that usually fixes it; "" if
    nothing failed."""
    if not _YTDLP_ERR:
        return ""
    err = _YTDLP_ERR[0]
    if re.search(r"not a bot|sign in to confirm|429|too many requests", err, re.I):
        return (f"yt-dlp: {err} — YouTube wants a signed-in session from this address: set "
                f"YTDLP_COOKIES_FROM_BROWSER=chrome (a spare Google account) and YT_SLEEP=2 in .env")
    return f"yt-dlp: {err}"


def _source(vid: str, work: Path) -> list:
    """What yt-dlp is pointed at for a video: its info file once one exists. Reading YouTube's page (and
    solving its JavaScript challenge) takes seconds; doing it once per video instead of once per shot
    is most of the cutting time on a long video. The links inside stay valid for hours."""
    info = work / "info" / f"{_safe(vid)}.info.json"
    with _LOCK:
        lock = _INFO_LOCKS.setdefault(vid, threading.Lock())
    with lock:
        if not info.exists():
            info.parent.mkdir(parents=True, exist_ok=True)
            r = subprocess.run(ytdlp() + ["-q", "--no-warnings", "--skip-download", "--write-info-json",
                                          "-o", str(info.parent / _safe(vid)), _watch_url(vid)],
                               capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=300)
            if not info.exists():
                _note_err(r.stderr)
    # the info file is there to skip YouTube's JavaScript challenge; an Archive film is a plain file, and cutting
    # a stretch out of it works from the link itself (a loaded info file makes yt-dlp refuse the section)
    if info.exists() and not str(vid).startswith("ia:") and time.time() - info.stat().st_mtime < 4 * 3600:
        return ["--load-info-json", str(info)]
    return [_watch_url(vid)]


def cut_clip(vid: str, start: float, end: float, dest: Path, work: Path, logo: bool = False,
             min_s: float = CLIP_MIN_S) -> float:
    """The shot [start, end] of a video as a clean, muted 1920x1080 clip. Returns its length, 0 if none.
    `logo`: the shot log saw a channel logo in a corner — cropped out even when the shot does not move."""
    pad = 1.2
    a, b = max(0.0, start - pad), end + pad
    sec = work / "sections" / f"{_safe(vid)}_{a:.1f}_{b:.1f}.mp4"
    sec.parent.mkdir(parents=True, exist_ok=True)
    if not sec.exists():
        for attempt in range(2):
            src = _source(vid, work) if attempt == 0 else [_watch_url(vid)]
            r = subprocess.run(ytdlp() + ["-q", "--no-warnings", "-f",
                                          "bv*[height<=1080][vcodec^=avc1]/bv*[height<=1080][vcodec!*=av01]/bv*[height<=1080]/b[height<=1080]/b",
                                          "--download-sections", f"*{a:.2f}-{b:.2f}", "--force-keyframes-at-cuts",
                                          "-o", str(sec.with_suffix("")) + ".%(ext)s"] + src,
                               capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=600)
            got = sorted(sec.parent.glob(sec.stem + ".*"))
            if not got:
                _note_err(r.stderr)
            if got:
                if got[0] != sec:
                    got[0].rename(sec)
                break
    if not sec.exists():
        return 0.0
    try:
        w, h, dur = _probe(sec)
        if not w or dur < min_s:
            return 0.0
        lo, hi = start - a, min(dur, end - a)
        cuts = [c for c in _cuts(sec) if c[1] > 0.05 and c[0] < dur - 0.05]
        # the model's bounds are good to about half a second: a real cut within a second moves them onto it
        dist = lambda c, t: 0.0 if c[0] <= t <= c[1] else min(abs(c[0] - t), abs(c[1] - t))
        near = lambda t: min((c for c in cuts if dist(c, t) <= 1.0), key=lambda c: dist(c, t), default=None)
        s0, e0 = near(lo), near(hi)
        # no cut within a second of a bound: the shot runs past it, or its edge is too soft to see —
        # a small margin either way
        lo = (s0[1] + 0.1) if s0 is not None else lo + 0.15
        hi = (e0[0] - 0.1) if e0 is not None else hi - 0.15
        # a cut still inside: the longest clean stretch between cuts
        free = [(lo, hi)]
        for c0, c1 in cuts:
            nxt = []
            for f0, f1 in free:
                if c1 + 0.1 <= f0 or c0 - 0.1 >= f1:
                    nxt.append((f0, f1))
                    continue
                nxt += [(f0, c0 - 0.1), (c1 + 0.1, f1)]
            free = [(f0, f1) for f0, f1 in nxt if f1 > f0]
        if not free:
            return 0.0
        lo, hi = max(free, key=lambda x: x[1] - x[0])
        room = hi - lo
        if room < min_s:
            return 0.0
        length = min(room, CLIP_MAX_S)
        s = lo + (room - length) / 2
        slow = 1.12 if length < 4.0 else 1.0          # a short shot plays a touch slower, as in the edit
        cw, ch, cx, cy = _window(sec, s, s + length, _active(sec, w, h, s, length), dur, logo)
        vf = ((f"setpts=PTS*{slow:.3f}," if slow > 1.0 else "") +
              f"crop={cw}:{ch}:{cx}:{cy},scale={W}:{H}:flags=lanczos,setsar=1,fps={FPS},format=yuv420p")
        p = subprocess.run(["ffmpeg", "-y", "-v", "error", "-ss", f"{s:.3f}", "-t", f"{length:.3f}", "-i", str(sec),
                            "-an", "-vf", vf, "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
                            str(dest)], capture_output=True, text=True)
        got = _probe(dest)[2] if p.returncode == 0 and dest.exists() else 0.0
        if got > 0:
            try:
                # press-camera strobes: one or two white frames at 60 fps read as a glitch once the clip is 30 fps
                import cinema
                cinema.unflash(dest)
            except Exception:                                  # noqa: BLE001 - the clip stays as it was cut
                pass
        if got > 0 and _too_dark(dest, got):
            dest.unlink(missing_ok=True)
            return 0.0
        return got if got >= min_s - 0.1 else 0.0
    finally:
        sec.unlink(missing_ok=True)


def _too_dark(path: Path, dur: float) -> bool:
    """A night scene that reads as a black screen: three frames all darker than a dim room."""
    lum = []
    for t in (dur * 0.2, dur * 0.5, dur * 0.8):
        p = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{t:.2f}", "-i", str(path), "-frames:v", "1",
                            "-vf", "scale=64:36,format=gray", "-f", "rawvideo", "-"], capture_output=True)
        if len(p.stdout) == 64 * 36:
            lum.append(sum(p.stdout) / (64 * 36))
    return bool(lum) and max(lum) < 18


def _signature(path: Path, dur: float):
    """What a clip shows, small enough to compare: for two of its frames, the whole picture and 45
    zoomed-in crops of it. Two clips of one photograph — pushed in on it by different amounts, as
    documentaries do — still match one of each other's crops."""
    from PIL import Image
    fulls, crops = [], []
    for t in (dur * 0.3, dur * 0.7):
        p = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{max(0.0, t):.2f}", "-i", str(path), "-frames:v", "1",
                            "-vf", "scale=160:90,format=gray", "-f", "rawvideo", "-"], capture_output=True)
        if len(p.stdout) != 160 * 90:
            continue
        img = Image.frombytes("L", (160, 90), p.stdout)
        for z in (1.0, 0.85, 0.72, 0.6, 0.5):
            cw, ch = int(160 * z), int(90 * z)
            for oy in sorted({0, (90 - ch) // 2, 90 - ch}):
                for ox in sorted({0, (160 - cw) // 2, 160 - cw}):
                    v = np.asarray(img.crop((ox, oy, ox + cw, oy + ch)).resize((40, 22), Image.BILINEAR), np.float32).ravel()
                    v = v - v.mean()
                    v = v / (float(np.linalg.norm(v)) + 1e-3)
                    (fulls if z == 1.0 else crops).append(v)
    if not fulls:
        return None
    return np.stack(fulls), np.stack(fulls + crops)


def _same_picture(a, b, limit: float = 0.8) -> bool:
    return bool((a[0] @ b[1].T).max() > limit or (b[0] @ a[1].T).max() > limit)


# ── the registry of moments already used ────────────────────────────────────────
def _used() -> dict:
    try:
        return json.loads(USED.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _overlaps(spans, s: float, e: float, job: str = "") -> bool:
    """Whether [s, e] overlaps a moment already used — by another video; a re-render of the same
    video may use its own moments again."""
    return any(not (e <= x[0] or s >= x[1]) for x in spans if not (job and len(x) > 2 and x[2] == job))


def _remember(picks: list, job: str = "") -> None:
    with _LOCK:
        used = _used()
        for vid, s, e in picks:
            spans = [x for x in used.get(vid, []) if not (len(x) > 2 and x[2] == job and not (e <= x[0] or s >= x[1]))]
            used[vid] = spans + [[round(s, 1), round(e, 1), job]]
        if len(used) > 500:                      # stays small: the most recent 500 videos
            used = dict(list(used.items())[-500:])
        USED.write_text(json.dumps(used), encoding="utf-8")


# a stretch that reads like history: a year, an era, a word only an archive film really answers
_ERA = re.compile(r"\b(1[89]\d\d|200\d)\b|archiv|newsreel|historic|cold war|soviet|ussr|kgb|world war|"
                  r"nuclear test|propaganda|famine|reactor|liquidator|refugee|border guard|labor camp|labour camp",
                  re.I)


def _bag(text: str) -> set:
    return {w for w in re.findall(r"[a-z0-9]+", str(text).lower()) if len(w) > 3}


def _archive_into(engine, needs: list, info: dict, ydir: Path, cfg: dict, used: dict, job: Path,
                  about_games: bool = False) -> list:
    """Free-licence films from the Internet Archive, watched before Claude picks, and handed to every stretch
    whose words they answer. The historical stretches are searched first, spread over the whole script so the
    films do not all land in one chapter. Returns the ids added to `info`."""
    if "archive" not in cfg["sources"] or cfg["archive_watch"] <= 0 or not needs:
        return []
    try:
        import archiveorg
    except ImportError:
        return []
    want = int(cfg["archive_watch"])
    era = [x for x in needs if _ERA.search(f"{x.get('q', '')} {x.get('q2', '')} {x.get('need', '')} {x.get('text', '')}")]
    order = era or needs
    # spread: the script is cut into as many parts as there are films to fetch, one stretch from each
    step = max(1, len(order) // max(1, want))
    asked = [order[i] for i in range(0, len(order), step)][:want * 3]
    # the story's own subject, taken from the words its searches keep asking for (the searches are English
    # whatever the narration speaks): two whole-subject queries stand at the front, because a film about the
    # subject serves the whole video, not one stretch
    counted = collections.Counter(w for x in needs for w in _bag(x.get("q") or "") if len(w) > 4)
    subject = [w for w, _ in counted.most_common(3)]
    topic = " ".join(subject[:2])
    if topic:
        asked = [{"q": f"{topic} newsreel", "w": None}, {"q": f"{topic} film", "w": None}] + asked

    def look(x):
        try:
            # the film has to be about this story's own subject: a stretch asking for "prisoners released"
            # must not come back with a film about a court case on the other side of the world
            return archiveorg.candidates(str(x.get("q") or x.get("need") or "")[:90], n=2,
                                         min_height=cfg["archive_min_height"], must=subject or None)
        except Exception:                                      # noqa: BLE001 - a search is never worth the video
            return []

    with ThreadPoolExecutor(max_workers=4) as ex:
        found = list(ex.map(look, asked))
    seen, films = {str(v) for v in info}, []
    for x, cands in zip(asked, found):
        for c in cands:
            if c["id"] in seen:
                continue
            seen.add(c["id"])
            films.append(dict(c, for_w=x.get("w")))
            break
        if len(films) >= want:
            break
    if not films:
        return []
    _log(engine, f"  Internet Archive: watching {len(films)} free-licence film(s) — "
                 + ", ".join(f"{c['title'][:40]} ({c['year'] or '?'})" for c in films[:4]))

    def watch_ia(c):
        try:
            return c, shots(c["id"], ydir)
        except Exception as e:                                 # noqa: BLE001 - one film is never worth the rest
            _log(engine, f"    {c['identifier'][:40]}: not watched — {str(e)[:100]}")
            return c, {}

    added = []
    with ThreadPoolExecutor(max_workers=3) as ex:
        for c, lg in ex.map(watch_ia, films):
            rows = [s for s in usable(lg, c["title"])
                    if about_games or s["kind"] != "game"
                    if not _overlaps(used.get(c["id"], []), s["start"], s["end"], job.name)]
            if not rows:
                continue
            # what the film really is, in the watcher's own words ("firefighters at an air base in Alaska"),
            # not the two words an uploader typed ("Firefighters Respond to Fire") — the choosing reads this,
            # and a documentary must not cut to the wrong country because a title was vague
            told = str(lg.get("video") or "").strip()
            info[c["id"]] = {"id": c["id"], "title": (f"{told} — {c['title']}" if told else c["title"])[:160],
                             "channel": "Internet Archive", "height": int(c.get("height") or 0), "usable": rows,
                             "credit": c.get("credit"), "licence": c.get("licence"), "page": c.get("page")}
            added.append(c["id"])
            # every stretch this film can really answer gets it as a candidate
            shown = _bag(" ".join(s["shows"] for s in rows) + " " + c["title"])
            for x in needs:
                asked_for = x.get("q") and c.get("for_w") == x.get("w")
                if asked_for or len(_bag(f"{x.get('q', '')} {x.get('need', '')}") & shown) >= 2:
                    x["videos"] = list(dict.fromkeys(list(x.get("videos") or []) + [c["id"]]))
    if added:
        _log(engine, f"  Internet Archive: {sum(len(info[v]['usable']) for v in added)} usable shot(s) from "
                     f"{len(added)} film(s)")
    return added


# ── the whole step ─────────────────────────────────────────────────────────────
def fetch_clips(engine, script: str, job: Path, style: str, force: bool, title: str = "") -> list:
    """[{path, t, dur, video, start, end, need}] in narration order — `t` is the second of narration
    the clip was chosen for, `dur` how long the clip really runs."""
    ydir = job / "youtube"
    manifest = ydir / "clips.json"
    if manifest.exists() and not force:
        rows = [r for r in json.loads(manifest.read_text(encoding="utf-8")) if Path(r["path"]).exists()]
        if rows:
            _log(engine, f"cached: {len(rows)} YouTube clips")
            return rows
    if not available():
        _log(engine, "YouTube footage: yt-dlp or a video-model key is missing — skipped")
        return []
    ydir.mkdir(parents=True, exist_ok=True)
    _YTDLP_ERR.clear()
    cfg = settings(engine, style)
    _PREFER.update(watcher=cfg["watcher"], kinds=cfg["kinds"], text_ok=cfg["text_ok"], no_drawn=cfg["no_drawn"])
    needs = [x for x in plan_needs(engine, script, job, title, force,
                                   float((getattr(engine, "STYLE_WPM", {}) or {}).get(style) or 0), style) if x.get("q")]
    if not needs:
        return []
    t0 = time.time()
    queries = sorted({q for x in needs for q in (x["q"], (x.get("q2") or "") if cfg["second_search"] else "") if q})
    with ThreadPoolExecutor(max_workers=_pool(4)) as ex:
        found = dict(zip(queries, ex.map(search, queries)))
    for x in needs:
        # the best videos of both searches, the main search's first
        x["videos"] = list(dict.fromkeys([v["id"] for v in found.get(x["q"], [])[:cfg["candidates"]]] +
                                         ([v["id"] for v in found.get(x.get("q2") or "", [])[:cfg["candidates"]]]
                                          if cfg["second_search"] else [])))
    info = {v["id"]: v for rows in found.values() for v in rows}
    vids = list(dict.fromkeys(v for x in needs for v in x["videos"]))
    # a blurry 240p upload is not worth watching: every candidate's sharpest picture, from its info file (read
    # once — the captions and the cutting use the same file), and anything under 480 lines is left out wherever
    # a sharper video was found for the same stretch
    with ThreadPoolExecutor(max_workers=_pool(8)) as ex:
        for vid, hgt in zip(vids, ex.map(lambda v: _height(v, ydir), vids)):
            info[vid]["height"] = hgt
    for x in needs:
        sharp = [v for v in x["videos"] if info[v].get("height", 0) >= 480 or not info[v].get("height")]
        x["videos"] = sharp or sorted(x["videos"], key=lambda v: -info[v].get("height", 0))[:1]
    blurry = [v for v in vids if not any(v in x["videos"] for x in needs)]
    if blurry:
        _log(engine, f"  {len(blurry)} low-resolution video(s) left out (under 480 lines)")
    vids = list(dict.fromkeys(v for x in needs for v in x["videos"]))
    _log(engine, f"YouTube: {len(queries)} searches — {analyst()} is watching {len(vids)} videos...")

    # where to watch: a short video whole, a long one where its own words touch the story (plan_focus)
    focus = plan_focus(engine, title, needs, [info[v] for v in vids if v in info], ydir)
    if not can_focus():
        focus = {v: (None if s else s) for v, s in focus.items()}
    whole = [v for v in vids if focus.get(v) is None]
    parts = {v: s for v, s in focus.items() if s}
    skipped = [v for v, s in focus.items() if s == []]
    long_min = sum(float(info[v].get("duration") or 0) for v in list(parts) + skipped) / 60
    part_min = sum(b - a for s in parts.values() for a, b in s) / 60
    if parts or skipped:
        _log(engine, f"  focus: {len(whole)} watched whole, {len(parts)} long ones only where they talk about the story "
                     f"({part_min:.0f} of {long_min:.0f} min), {len(skipped)} off-topic skipped")

    def watch(vid):
        if focus.get(vid) == []:
            return vid, {}
        try:
            return vid, shots(vid, ydir, focus.get(vid))
        except Exception as e:                                 # noqa: BLE001 - one video is never worth the rest
            _log(engine, f"  {vid}: not watched — {str(e)[:120]}")
            return vid, {}

    with ThreadPoolExecutor(max_workers=5 if analyst() in ("algrow", "gemini", "openlux") else 3) as ex:
        logs = dict(ex.map(watch, vids))
    used = _used()
    # a video game's footage belongs in a video about games — a "simulated World Cup final" from a football
    # game must never stand in for the real match
    about_games = bool(_GAME.search(f"{title} {script[:3000]}")) or bool(re.search(r"\b(game|gaming|gamer)s?\b", title, re.I))
    for vid in vids:
        info[vid]["usable"] = [s for s in usable(logs.get(vid) or {}, f"{info[vid].get('title', '')} {info[vid].get('channel', '')}")
                               if about_games or s["kind"] != "game"
                               if not _overlaps(used.get(vid, []), s["start"], s["end"], job.name)]
    n_ok = sum(len(info[v]["usable"]) for v in vids)
    # the Internet Archive before the choosing, not only after it: its films are free to fetch and free to
    # watch, and they hold the real era YouTube cannot show
    vids += _archive_into(engine, needs, info, ydir, cfg, used, job, about_games)
    n_ok = sum(len(info[v]["usable"]) for v in vids)
    _log(engine, f"  {n_ok} usable shots logged in {time.time() - t0:.0f}s — Claude is choosing...")

    # Claude chooses in batches of four windows, each batch seeing the videos found for its windows
    batches = [needs[i:i + 4] for i in range(0, len(needs), 4)]

    # how often the channel cuts (style pacing.cut_s): a gaming edit every two or three seconds, a documentary every four
    cut_s = float(((getattr(engine, "STYLE_INFO", {}) or {}).get(style, {}).get("pacing") or {}).get("cut_s") or 4.0)

    def choose(batch):
        bv = list(dict.fromkeys(v for x in batch for v in x["videos"] if info.get(v, {}).get("usable")))
        return _pick(engine, title, batch, [info[v] for v in bv], cut_s)

    with ThreadPoolExecutor(max_workers=3) as ex:
        chosen = [p for part in ex.map(choose, batches) for p in part]

    # A stretch whose own search found nothing usable would fall back on graphics, while videos already
    # watched for other stretches sit there unused. Those stretches get a second pass over the whole
    # catalogue — the watched videos whose shots speak most about that stretch — which costs no watching
    # at all and keeps the edit from repeating a clip just to fill the hole.
    served = {need["w"] for need, *_ in chosen}
    empty = [x for x in needs if x["w"] not in served]
    pool = [info[v] for v in vids if info.get(v, {}).get("usable")]
    # videos watched for an earlier cut of this job are in the catalogue even when today's search no longer
    # returns them (YouTube's results drift from day to day) — their shot logs are paid for, so they join the
    # pool too, with only what the log itself says about them
    if empty:
        for cat in sorted((ydir / "catalog").glob("*.json")):
            try:
                log_ = json.loads(cat.read_text(encoding="utf-8"))
            except (ValueError, OSError):
                continue
            vid_ = str(log_.get("id") or cat.stem)
            if vid_ in info:
                continue
            rows_ = [s for s in usable(log_)
                     if about_games or s["kind"] != "game"
                     if not _overlaps(used.get(vid_, []), s["start"], s["end"], job.name)]
            if rows_:
                info[vid_] = {"id": vid_, "title": "", "channel": "Internet Archive" if vid_.startswith("ia:") else "",
                              "usable": rows_}
                pool.append(info[vid_])
    # the Internet Archive: government films, newsreels and other free-licence footage YouTube does not have.
    # It costs nothing to fetch, so it is asked for exactly the stretches nothing else could show.
    if empty and "archive" in cfg["sources"] and cfg["archive_watch"] > 0:
        try:
            import archiveorg
        except ImportError:
            archiveorg = None
        want_ia = []
        counted_ = collections.Counter(w for x in needs for w in _bag(x.get("q") or "") if len(w) > 4)
        subject = [w for w, _ in counted_.most_common(3)]
        if archiveorg is not None:
            seen_ia = {str(v) for v in info}
            for x in empty:
                if len(want_ia) >= cfg["archive_watch"]:
                    break
                for c in archiveorg.candidates(str(x.get("q") or x.get("need") or "")[:90], n=2,
                                               min_height=cfg["archive_min_height"], must=subject or None):
                    if c["id"] in seen_ia:
                        continue
                    seen_ia.add(c["id"])
                    want_ia.append(c)
                    break
        if want_ia:
            _log(engine, f"  Internet Archive: {len(want_ia)} free-licence film(s) — "
                         + ", ".join(f"{c['title'][:40]} ({c['year'] or '?'})" for c in want_ia[:4]))

            def watch_ia(c):
                try:
                    return c, shots(c["id"], ydir)
                except Exception as e:                         # noqa: BLE001 - one film is never worth the rest
                    _log(engine, f"    {c['identifier'][:40]}: not watched — {str(e)[:100]}")
                    return c, {}
            with ThreadPoolExecutor(max_workers=3) as ex:
                for c, lg in ex.map(watch_ia, want_ia):
                    rows_ = [s for s in usable(lg, c["title"])
                             if not _overlaps(used.get(c["id"], []), s["start"], s["end"], job.name)]
                    if not rows_:
                        continue
                    info[c["id"]] = {"id": c["id"], "title": c["title"], "channel": "Internet Archive",
                                     "height": int(c.get("height") or 0), "usable": rows_,
                                     "credit": c.get("credit"), "licence": c.get("licence"), "page": c.get("page")}
                    pool.append(info[c["id"]])
            _log(engine, f"  Internet Archive: {sum(len(info[v]['usable']) for v in info if str(v).startswith('ia:'))}"
                         f" usable shot(s) added")
    if empty and len(pool) > 1:
        _log(engine, f"  {len(empty)} stretch(es) found nothing of their own — looking through all "
                     f"{len(pool)} watched video(s)...")
        bag = lambda s_: {w for w in re.findall(r"[a-z0-9]+", str(s_).lower()) if len(w) > 3}

        def choose_wide(batch):
            want = bag(" ".join(f"{x.get('text', '')} {x.get('need', '')} {x.get('q', '')} {x.get('q2', '')}"
                                for x in batch))
            rank = sorted(pool, key=lambda v: -sum(len(bag(s_["shows"]) & want) for s_ in v["usable"]))
            return _pick(engine, title, batch, rank[:WIDE_VIDEOS], cut_s)

        wide = [empty[i:i + 4] for i in range(0, len(empty), 4)]
        with ThreadPoolExecutor(max_workers=3) as ex:
            more = [p for part in ex.map(choose_wide, wide) for p in part]
        if more:
            _log(engine, f"  {len(more)} more shot(s) for {len({m[0]['w'] for m in more})} of those stretches")
        chosen += more

    # one moment is never cut twice, even when two batches chose it
    jobs, spans = [], {}
    for need, vid, s, e, text, line in chosen:
        if _overlaps(spans.get(vid, []), s, e):
            continue
        spans.setdefault(vid, []).append((s, e))
        jobs.append((need, vid, s, e, text, line))
    per_w = {}

    def cut(item):
        need, vid, s, e, text, _line = item
        k = per_w.setdefault(need["w"], [0])
        with _LOCK:
            j = k[0]
            k[0] += 1
        dest = ydir / f"yt_{need['w']:03d}_{j}.mp4"
        # a game trailer cuts every second or two by design: its shots are used as short as they come
        quick = bool(_GAME.search(f"{info.get(vid, {}).get('title', '')}")) and bool(
            re.search(r"\b(trailer|reveal|extended look|teaser)\b", info.get(vid, {}).get("title", ""), re.I))
        try:
            got = cut_clip(vid, s, e, dest, ydir, logo=(text == "small"), min_s=1.4 if quick else CLIP_MIN_S)
        except Exception as ex_:                               # noqa: BLE001
            _log(engine, f"  {vid} {_mmss(s)}: not cut — {str(ex_)[:100]}")
            got = 0.0
        return item, dest, j, got

    rows, sigs, short, same = [], [], 0, 0
    with ThreadPoolExecutor(max_workers=_pool(6)) as ex:
        for (need, vid, s, e, _text, line), dest, j, got in ex.map(cut, jobs):
            sig = _signature(dest, got) if got > 0 else None
            # the same photograph shown twice in a source video is still the same picture
            if got <= 0 or (sig is not None and any(_same_picture(sig, o) for o in sigs)):
                short += got <= 0
                same += got > 0
                dest.unlink(missing_ok=True)
                continue
            if sig is not None:
                sigs.append(sig)
            rows.append({"path": str(dest), "w": need["w"], "t": need["t"], "order": j, "dur": round(got, 2),
                         "video": vid, "start": s, "end": e, "need": need["need"], "line": line,
                         # the source, for a style that credits borrowed footage on screen (look.credits)
                         "title": str((info.get(vid) or {}).get("title") or "")[:160],
                         "channel": str((info.get(vid) or {}).get("channel") or "")[:80]})
    # in each window the clips follow the order Claude ranked them, spread across the window
    rows.sort(key=lambda r: (r["w"], r["order"]))
    win_s = {x["w"]: float(x.get("dur") or WINDOW_S) for x in needs}
    for w in {r["w"] for r in rows}:
        mine = [r for r in rows if r["w"] == w]
        for k, r in enumerate(mine):
            r["t"] = round(r["t"] + k * win_s.get(w, WINDOW_S) / max(1, len(mine)), 1)
    _remember([(r["video"], r["start"], r["end"]) for r in rows], job.name)
    manifest.write_text(json.dumps(rows, indent=1, ensure_ascii=False), encoding="utf-8")
    # what the video owes a credit line: every Archive film it ended up using (the licences ask for it)
    credits_ = {}
    for r in rows:
        v = info.get(r.get("video")) or {}
        if str(r.get("video", "")).startswith("ia:") and v.get("credit"):
            credits_[r["video"]] = {"credit": v["credit"], "licence": v.get("licence", ""), "page": v.get("page", "")}
    if credits_:
        (job / "footage_credits.json").write_text(json.dumps(list(credits_.values()), indent=1, ensure_ascii=False),
                                                  encoding="utf-8")
    shutil.rmtree(ydir / "sections", ignore_errors=True)
    shutil.rmtree(ydir / "info", ignore_errors=True)
    covered = len({r["w"] for r in rows})
    _log(engine, f"YouTube: {len(rows)} clips for {covered} of {len(needs)} stretches in {time.time() - t0:.0f}s "
                 f"({len(chosen)} chosen, {short} without a clean {CLIP_MIN_S:.1f}s, {same} showing the same picture)")
    if short and last_error():
        _log(engine, f"  {'most' if rows else 'all'} of those did not download — {last_error()}")
    return rows


if __name__ == "__main__":
    try:
        from dotenv import load_dotenv
        load_dotenv(HERE / ".env")
    except ImportError:
        pass
    cmd, *args = sys.argv[1:] or ["help"]
    if cmd == "search":
        for v in search(" ".join(args)):
            print(f"{v['id']}  {int(v['duration']):>5}s  {v['channel'][:24]:<24}  {v['title'][:80]}")
    elif cmd == "shots":
        log = shots(args[0], HERE / "preview" / "youtube")
        ok = {s["i"] for s in usable(log)}
        for i, s in enumerate(log.get("shots") or []):
            print(f"{'+' if i in ok else ' '} {s.get('start')}-{s.get('end')}  {s.get('kind', ''):<9} {s.get('shows', '')[:90]}")
    else:
        print(__doc__)
