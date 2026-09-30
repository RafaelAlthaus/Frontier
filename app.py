#!/usr/bin/env python3
"""app.py — Frontier's local control room.

Start it, and a browser opens on http://127.0.0.1:7860. Pick a channel, type a
title, press Create. One job runs at a time — rendering is heavy local work and
two at once just makes both slower.

    python app.py

The interface itself is `ui.html`, sitting next to this file and read fresh on
every request. Edit it, reload the page, see the change — no restart, no build
step, no Python to touch.
"""

import hashlib
import io
import os
import re
import subprocess
import sys
import threading
import time
import webbrowser
import zipfile
from pathlib import Path

from flask import Flask, Response, jsonify, redirect, request, send_file

import avatar
import make_video as mv
import motion
import features
import styles

HERE = Path(__file__).resolve().parent
OUT = mv.OUTPUT_ROOT
UI = HERE / "ui.html"
# another app on 7860? FRONTIER_PORT=7870 python app.py
PORT = int(os.environ.get("FRONTIER_PORT") or 7860)
SAFE = re.compile(r"^[\w.\-]+$")          # filename guard for the file routes

app = Flask(__name__)

JOBS: dict = {}            # slug -> {lines, state, error, done, title, steps}
RUNNING = {"slug": None}   # the job currently rendering
QUEUE: list = []           # pending specs, processed in order
HISTORY: list = []         # finished slugs, oldest first
LOCK = threading.Lock()

VALID_STEPS = {"script", "voiceover", "pexels", "images", "video", "thumbnail"}

# Channels are files, not code — read them in before anything can be rendered.
LOADED = styles.apply_to_engine(mv, motion)


# ── the queue ──────────────────────────────────────────────────────────────

def _run_spec(spec):
    slug = spec["slug"]
    job = JOBS.setdefault(slug, {})
    job.update(lines=job.get("lines", []), state="running", error=None, done=False,
               title=spec["title"], steps=spec["steps"], started=time.time(),
               minutes=spec.get("minutes", 20), style=spec.get("style", ""))

    def sink(line):
        job["lines"].append(line)

    try:
        mv.run_custom(spec["title"], spec["minutes"], steps=spec["steps"],
                      script_text=spec["script_text"], force=spec["force"],
                      burn_subs=spec["burn_subs"], sink=sink, style=spec["style"],
                      thumb_count=spec["thumb_count"],
                      use_motion=spec.get("use_motion", True),
                      byo_audio=spec.get("byo_audio", ""),
                      mix=spec.get("mix") or (), meta=spec.get("meta"),
                      character=spec.get("character", ""),
                      character_image=spec.get("character_image", ""),
                      maps=spec.get("maps", True), headlines=spec.get("headlines", True),
                      spotlight=spec.get("spotlight", True), objects=spec.get("objects", True),
                      depth=spec.get("depth", True),
                      features=spec.get("features"), extra=spec.get("extra", ""),
                      avatar_id=spec.get("avatar_id", ""), avatar_s=spec.get("avatar_s", 0),
                      avatar_count=spec.get("avatar_count", 1))
        job["state"] = "done"
    except BaseException as e:                                   # noqa: BLE001
        job["error"] = str(e) or e.__class__.__name__
        job["state"] = "error"
        job["lines"].append(f"ERROR: {job['error']}")
    finally:
        job["done"] = True
        with LOCK:
            HISTORY.append(slug)
            RUNNING["slug"] = None


def _dispatcher():
    while True:
        spec = None
        with LOCK:
            if RUNNING["slug"] is None and QUEUE:
                spec = QUEUE.pop(0)
                RUNNING["slug"] = spec["slug"]
        if spec is None:
            time.sleep(0.4)
            continue
        _run_spec(spec)


_DISPATCHER = None


def _ensure_dispatcher():
    global _DISPATCHER
    if _DISPATCHER is None or not _DISPATCHER.is_alive():
        _DISPATCHER = threading.Thread(target=_dispatcher, daemon=True)
        _DISPATCHER.start()


# ── API ────────────────────────────────────────────────────────────────────

@app.post("/api/run")
def api_run():
    d = request.get_json(force=True)
    titles = [t.strip() for t in (d.get("title") or "").splitlines() if t.strip()]
    if not titles:
        return jsonify(error="Give it at least one title — one per line."), 400

    steps = [s for s in (d.get("steps") or []) if s in VALID_STEPS]
    if not steps:
        return jsonify(error="Pick at least one thing to make."), 400

    style = d.get("style") or ""
    if style not in mv.prompts.PROMPT_SETS:
        have = ", ".join(sorted(mv.prompts.PROMPT_SETS)) or "none yet"
        return jsonify(error=f"No channel called '{style}'. Available: {have}."), 400

    try:
        minutes = max(1, min(60, int(d.get("minutes") or 10)))
    except (TypeError, ValueError):
        minutes = 10
    try:
        thumb_count = max(1, min(4, int(d.get("thumb_count") or 2)))
    except (TypeError, ValueError):
        thumb_count = 2

    # the mix sliders: three numbers that add up to 100 (AI stills, stock, graphics)
    mix = ()
    raw_mix = d.get("mix") or []
    if isinstance(raw_mix, (list, tuple)) and len(raw_mix) == 3:
        try:
            mix = tuple(max(0.0, float(x)) for x in raw_mix)
        except (TypeError, ValueError):
            mix = ()
    # the YouTube description, with as many chapters and sources as asked for
    meta = None
    if d.get("desc"):
        def _n(key, lo, hi):
            try:
                return max(lo, min(hi, int(d.get(key) or 0)))
            except (TypeError, ValueError):
                return lo
        meta = {"chapters": _n("chapters", 0, 20), "sources": _n("sources", 0, 10)}

    spec_base = dict(
        steps=steps, minutes=minutes, script_text=d.get("script") or "", mix=mix, meta=meta,
        burn_subs=bool(d.get("burn_subs", True)), force=bool(d.get("force", False)),
        style=style, thumb_count=thumb_count,
        use_motion=bool(d.get("use_motion", True)),
        byo_audio=(d.get("byo_audio") or "").strip(),
        character=(d.get("character") or "").strip()[:4000],
        character_image=_char_rel(d.get("character_image")),
        maps=bool(d.get("maps", True)),
        headlines=bool(d.get("headlines", True)),
        spotlight=bool(d.get("spotlight", True)),
        objects=bool(d.get("objects", True)),
        depth=bool(d.get("depth", True)),
        # the Options switches (features.FEATURES keys -> on/off) and the extra instructions
        features={k: bool(v) for k, v in (d.get("features") or {}).items() if k in features.BY_KEY} or None,
        extra=(d.get("extra") or "").strip()[:4000],
        # the AI presenter: which face, and how many seconds of it to open with
        avatar_id=(d.get("avatar_id") or "").strip()[:64],
        avatar_s=max(0.0, min(float(d.get("avatar_s") or 0), 15.0)),
        avatar_count=max(1, min(int(d.get("avatar_count") or 1), avatar.MAX_COUNT)),
    )

    queued = []
    threed = _threed_on(style, spec_base.get("features"))    # the progress view draws the 3D steps for this job
    for t in titles:
        slug = mv.slugify(t)
        spec = dict(spec_base, title=t, slug=slug)
        JOBS[slug] = {"lines": [], "state": "queued", "error": None, "done": False,
                      "title": t, "steps": steps, "minutes": minutes, "style": style, "threed": threed}
        with LOCK:
            QUEUE.append(spec)
        queued.append({"slug": slug, "title": t})
    _ensure_dispatcher()
    return jsonify(queued=queued)


@app.get("/api/channels")
def api_channels():
    """The channel picker. Reloaded from disk each time, so a style file edited
    in Claude Code shows up on a page refresh instead of needing a restart."""
    styles.load_all()
    styles.apply_to_engine(mv, motion)
    # which DLCs are on this machine, so Options only offers what can actually run
    dlc = {"maps": (HERE / "maps.py").exists() and (HERE / "assets" / "maps" / "gazetteer.json").exists(),
           "headlines": (HERE / "headlines.py").exists() and (HERE / "assets" / "headlines" / "page.js").exists(),
           "photofx": (HERE / "photofx.py").exists() and (HERE / "assets" / "photofx" / "page.js").exists()}
    # every switch in Options, and whether its API key is there — a missing key shows in red
    return jsonify(channels=styles.catalogue(), dlc=dlc, features=features.FEATURES,
                   caps=features.capabilities(), prices=features.prices())


@app.get("/api/queue")
def api_queue():
    with LOCK:
        pending = [{"slug": s["slug"], "title": s["title"]} for s in QUEUE]
        running = RUNNING["slug"]
    out = []
    if running and running in JOBS:
        j = JOBS[running]
        el = time.time() - j.get("started", time.time())
        out.append({"slug": running, "title": j.get("title", running),
                    "state": "running", "elapsed": int(el),
                    "line": (j["lines"][-1] if j.get("lines") else ""),
                    "progress": _progress(j), "threed": bool(j.get("threed"))})
    out += [{**p, "state": "queued"} for p in pending]
    for slug in reversed(HISTORY[-12:]):
        j = JOBS.get(slug) or {}
        out.append({"slug": slug, "title": j.get("title", slug),
                    "state": j.get("state", "done"), "error": j.get("error")})
    return jsonify(jobs=out, busy=bool(running))


def _progress(job) -> float:
    """0..1 — how far through the step list this job has got.

    Read off the log rather than tracked separately: the pipeline already
    announces each stage, and a second source of truth would drift from it.
    """
    steps = job.get("steps") or []
    if not steps:
        return 0.0
    if job.get("threed") and "video" in steps:
        return _progress_3d(job.get("lines", []))
    text = "\n".join(job.get("lines", [])[-400:])
    marks = [("script", "1/"), ("voiceover", "2/"), ("images", "kie:"),
             ("pexels", "Pexels:"), ("video", "segments"), ("thumbnail", "thumbnail")]
    done = sum(1 for name, mark in marks if name in steps and mark in text)
    return min(0.98, done / max(1, len(steps)))


def _threed_on(style: str, asked=None) -> bool:
    """Whether a job of this channel makes 3D scenes (the channel asks for them and the switch is on)."""
    st = styles.STYLES.get(style) or {}
    if not ((st.get("look") or {}).get("threed")):
        return False
    try:
        return bool(features.resolve(st, asked if isinstance(asked, dict) else None).get("threed"))
    except Exception:                                            # noqa: BLE001
        return False


def _final_ready(slug: str) -> bool:
    try:
        return mv.final_video(_job(slug)).exists()
    except Exception:                                            # noqa: BLE001
        return False


def _progress_3d(lines: list) -> float:
    """0..1 for a 3D video, read off its log: the 3D takes most of the time, so its steps carry most of the bar —
    director, review rounds N/M, final render K/N scenes, then the edit and the sound."""
    p = 0.0
    for l in lines[-600:]:
        if "=== 1/" in l:
            p = max(p, 0.03)
        elif "=== 2/" in l:
            p = max(p, 0.08)
        elif "=== 3/" in l or "Graphics (" in l:
            p = max(p, 0.16)
        elif "3D: moments" in l:
            p = max(p, 0.20)
        elif "3D: director" in l:
            p = max(p, 0.23)
        elif "3D: previews" in l or "3D: review" in l:
            m = re.search(r"(?:round |review )(\d+)/(\d+)", l)
            if m:
                k, n = int(m.group(1)), max(1, int(m.group(2)))
                p = max(p, 0.28 + 0.22 * (k - (0.5 if "previews" in l else 0)) / n)
        elif "3D: final render" in l:
            m = re.search(r"final render (\d+)/(\d+)", l)
            if m:
                p = max(p, 0.50 + 0.35 * int(m.group(1)) / max(1, int(m.group(2))))
        elif "3D: assembly" in l or "3D: " in l and "clips on the timeline" in l:
            p = max(p, 0.86)
        elif "=== 4/" in l:
            p = max(p, 0.88)
        elif re.search(r"segments (\d+)/(\d+)", l):
            m = re.search(r"segments (\d+)/(\d+)", l)
            p = max(p, 0.88 + 0.08 * int(m.group(1)) / max(1, int(m.group(2))))
    return min(0.98, p)


@app.post("/api/queue/clear")
def api_queue_clear():
    with LOCK:
        n = len(QUEUE)
        QUEUE.clear()
    return jsonify(cleared=n)


@app.get("/api/status/<slug>")
def api_status(slug):
    j = JOBS.get(slug)
    if not j:
        return jsonify(error="unknown job"), 404
    return jsonify(lines=j.get("lines", [])[-500:], state=j.get("state"),
                   done=j.get("done"), error=j.get("error"),
                   progress=_progress(j), style=j.get("style", ""), threed=bool(j.get("threed")),
                   # the finished video, and only it: a 3D job never shows its preview stills or pre-check renders
                   video=bool(j.get("done") and not j.get("error") and _final_ready(slug)))


def _job(slug: str) -> Path:
    """A video's working folder — output/<style>/<slug>/_work, or an older output/<slug>."""
    return mv.find_job(slug) or (OUT / slug)


@app.get("/api/result/<slug>")
def api_result(slug):
    job = _job(slug)
    if not job.is_dir():
        return jsonify(error="no such job"), 404
    thumbs = sorted(p.name for p in job.glob("thumbnail_[0-9]*.png"))
    return jsonify(
        slug=slug,
        title=(job / "title.txt").read_text(encoding="utf-8").splitlines()[0]
        if (job / "title.txt").exists() else slug,
        video=mv.final_video(job).exists(),
        audio=(job / "audio.mp3").exists(),
        script=(job / "script.txt").exists(),
        srt=(job / "subs.srt").exists(),
        desc=(job / "youtube.txt").exists(),
        thumbs=thumbs,
        clips=len(list((job / "pexels").glob("*.mp4"))) if (job / "pexels").is_dir() else 0,
        images=len(list((job / "images").glob("*.jpg"))) if (job / "images").is_dir() else 0,
    )


@app.get("/api/jobs")
def api_jobs():
    """Everything already rendered, newest first."""
    rows = []
    if OUT.is_dir():
        for d in mv.list_jobs():
            v = mv.final_video(d)
            if not (d.is_dir() and v.exists()):
                continue
            t = (d / "title.txt")
            # the working folder's name is the slug every file route takes (find_job): the folder the video is
            # filed in is named after the title, spaces and all, and the routes refused it as a "bad slug"
            thumbs = sorted(p.name for p in d.glob("thumbnail*.png") if SAFE.match(p.name))
            rows.append({"slug": d.name,
                         "thumbs": thumbs,
                         "title": t.read_text(encoding="utf-8").splitlines()[0] if t.exists() else d.name,
                         "mtime": v.stat().st_mtime,
                         "size": v.stat().st_size,
                         "desc": (d / "youtube.txt").exists(),
                         "style": (d / "style.txt").read_text(encoding="utf-8").strip()
                         if (d / "style.txt").exists() else ""})
    rows.sort(key=lambda r: r["mtime"], reverse=True)
    # which file manager "Open in …" opens on this computer
    platform = "mac" if sys.platform == "darwin" else "windows" if os.name == "nt" else "linux"
    return jsonify(jobs=rows[:60], platform=platform)


@app.post("/api/reveal/<slug>")
def api_reveal(slug):
    """Open the video's folder in the file manager with the video selected: Finder on a Mac, File Explorer
    on Windows, the folder itself elsewhere. Frontier listens on 127.0.0.1 only, so only this computer asks."""
    if not SAFE.match(slug):
        return jsonify(error="bad slug"), 400
    d = _job(slug)
    target = mv.final_video(d)
    if not target.exists():
        return jsonify(error="That video is not on this computer any more."), 404
    d = mv.main_dir(d)
    try:
        if sys.platform == "darwin":
            subprocess.Popen(["open", "-R", str(target)])
        elif os.name == "nt":
            # one string on purpose: Explorer wants /select,"<path>" exactly as written
            subprocess.Popen(f'explorer /select,"{target}"')
        else:
            subprocess.Popen(["xdg-open", str(d)])
    except OSError as e:
        return jsonify(error=f"Could not open the folder ({e}). The video is in {d}"), 500
    return jsonify(ok=True, path=str(target))


# ── files ──────────────────────────────────────────────────────────────────

def _send(slug, *parts, **kw):
    if not SAFE.match(slug):
        return jsonify(error="bad slug"), 400
    p = _job(slug).joinpath(*parts)
    if not p.exists():
        return jsonify(error="not found"), 404
    return send_file(p, **kw)


@app.get("/f/video/<slug>")
def f_video(slug):
    if not SAFE.match(slug):
        return jsonify(error="bad slug"), 400
    v = mv.final_video(_job(slug))
    if not v.exists():
        return jsonify(error="not found"), 404
    return send_file(v, mimetype="video/mp4", conditional=True)


@app.get("/f/audio/<slug>")
def f_audio(slug):
    return _send(slug, "audio.mp3")


@app.get("/f/thumb/<slug>/<name>")
def f_thumb(slug, name):
    if not SAFE.match(name):
        return jsonify(error="bad name"), 400
    return _send(slug, name)


@app.get("/f/script/<slug>")
def f_script(slug):
    return _send(slug, "script.txt", mimetype="text/plain")


@app.get("/f/srt/<slug>")
def f_srt(slug):
    return _send(slug, "subs.srt", mimetype="text/plain")


@app.get("/f/desc/<slug>")
def f_desc(slug):
    """The YouTube description: text, chapters, tags, sources — ready to paste."""
    return _send(slug, "youtube.txt", mimetype="text/plain")


@app.get("/f/zip/<slug>/<folder>")
def f_zip(slug, folder):
    if not (SAFE.match(slug) and SAFE.match(folder)):
        return jsonify(error="bad path"), 400
    d = _job(slug) / folder
    if not d.is_dir():
        return jsonify(error="not found"), 404
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for p in sorted(d.iterdir()):
            if p.is_file():
                z.write(p, p.name)
    buf.seek(0)
    return send_file(buf, mimetype="application/zip", as_attachment=True,
                     download_name=f"{slug}-{folder}.zip")


CHAR_DIR = HERE / "assets" / "characters"
CHAR_EXT = {".png", ".jpg", ".jpeg", ".webp"}


def _char_rel(raw) -> str:
    """A character picked in Options, as a path under assets/ — or "" if it is not one."""
    rel = str(raw or "").strip().replace("\\", "/")
    name = rel[len("characters/"):] if rel.startswith("characters/") else ""
    if not name or "/" in name or ".." in name or Path(name).suffix.lower() not in CHAR_EXT:
        return ""
    return rel if (CHAR_DIR / name).is_file() else ""


def _char_items() -> list:
    """Every character picture in assets/characters, with the words that go with it."""
    own = {((st.get("look") or {}).get("character_image") or "").replace("\\", "/"): n
           for n, st in styles.STYLES.items()}
    out = []
    for p in sorted(CHAR_DIR.glob("*")) if CHAR_DIR.is_dir() else []:
        if not p.is_file() or p.suffix.lower() not in CHAR_EXT:
            continue
        rel = f"characters/{p.name}"
        side = p.with_suffix(".txt")
        out.append({"rel": rel, "file": p.name, "src": f"/charimg/{p.name}",
                    "label": re.sub(r"-[0-9a-f]{6}$", "", p.stem).replace("-", " ").strip() or "character",
                    "channel": own.get(rel, ""), "mtime": int(p.stat().st_mtime),
                    "text": side.read_text(encoding="utf-8").strip() if side.exists() else ""})
    return out


@app.get("/api/characters")
def api_characters():
    return jsonify(characters=_char_items())


@app.get("/charimg/<name>")
def f_charimg(name):
    p = CHAR_DIR / name
    if "/" in name or "\\" in name or ".." in name or p.suffix.lower() not in CHAR_EXT or not p.is_file():
        return Response(status=404)
    return send_file(p)


@app.post("/api/characters")
def api_character_upload():
    """A character of your own: saved beside the others, and put into words by
    Claude — the storyboard repeats those words in every image prompt."""
    f = request.files.get("file")
    if f is None:
        return jsonify(error="No picture came with the upload."), 400
    raw = f.read()
    if len(raw) > 20 * 1024 * 1024:
        return jsonify(error="That picture is over 20 MB — export a smaller one."), 400
    try:
        from PIL import Image, ImageOps
        im = Image.open(io.BytesIO(raw))
        im.load()
        im = ImageOps.exif_transpose(im)
    except Exception:                                            # noqa: BLE001
        return jsonify(error="Frontier cannot read that file as a picture — use PNG, JPG or WebP."), 400
    if im.mode not in ("RGB", "RGBA"):
        im = im.convert("RGBA")
    im.thumbnail((1600, 1600))              # plenty for a reference, quick to put online
    stem = re.sub(r"[^a-z0-9]+", "-", Path(f.filename or "").stem.lower()).strip("-")[:40] or "character"
    CHAR_DIR.mkdir(parents=True, exist_ok=True)
    dest = CHAR_DIR / f"{stem}-{hashlib.sha1(raw).hexdigest()[:6]}.png"
    im.save(dest, "PNG", optimize=True)
    try:
        dest.with_suffix(".txt").write_text(mv.describe_character(dest), encoding="utf-8")
    except BaseException as e:              # the Claude layer can sys.exit; the upload still stands
        print(f"  character description failed: {str(e)[:160]}")
    item = next((x for x in _char_items() if x["file"] == dest.name), None)
    return jsonify(character=item)


@app.get("/char/<style>")
def f_char(style):
    """The channel's main character (`look.character_image`), shown in Options."""
    st = styles.STYLES.get(style) or {}
    rel = ((st.get("look") or {}).get("character_image") or "").strip()
    p = HERE / "assets" / rel
    if not rel or ".." in rel or not p.exists():
        return Response(status=404)
    return send_file(p)


@app.get("/ref/<style>")
def f_ref(style):
    """The picture a channel is aiming at (`look.reference` in its style file).
    Missing is not an error — the card simply shows no image."""
    st = styles.STYLES.get(style) or {}
    rel = ((st.get("look") or {}).get("reference") or "").strip()
    p = HERE / "assets" / rel
    if not rel or ".." in rel or not p.exists():
        return Response(status=404)
    return send_file(p)


@app.get("/sample/<style>")
def f_sample(style):
    """A video of what the channel makes (`look.sample` in its style file, a path under assets/).
    The card plays it muted; "Watch sample" opens it with sound. Sent with range support, so the
    browser can seek without reading the whole file. Missing is not an error — the card shows the
    reference picture instead."""
    st = styles.STYLES.get(style) or {}
    plain = HERE / "samples" / f"{style}-plain.mp4"
    if request.args.get("plain") and SAFE.match(plain.name) and plain.is_file():
        return send_file(plain, mimetype="video/mp4", conditional=True, max_age=3600)
    rel = ((st.get("look") or {}).get("sample") or "").strip()
    p = HERE / "assets" / rel
    if not rel or ".." in rel or not p.is_file():
        # the finished sample every shipped channel has in samples/<name>.mp4
        p = HERE / "samples" / f"{style}.mp4"
        if not SAFE.match(f"{style}.mp4") or not p.is_file():
            return Response(status=404)
    kind = {".webm": "video/webm", ".mov": "video/quicktime"}.get(p.suffix.lower(), "video/mp4")
    return send_file(p, mimetype=kind, conditional=True, max_age=3600)


@app.get("/brand/<name>")
def f_brand(name):
    """Frontier and Algrow marks. Missing files are not an error — the page
    falls back to type, so the tool still runs before the logos are dropped in."""
    if not SAFE.match(name):
        return jsonify(error="bad name"), 400
    p = HERE / "assets" / "brand" / name
    if not p.exists():
        return Response(status=404)
    return send_file(p)


# ── the render farm ────────────────────────────────────────────────────────
# Same job, someone else's computer. The engine is farm/, imported only when one
# of these routes is called: a Frontier with no farm set up must behave exactly
# as it did before, and an import error here would break the whole app.

FARM = {"lines": [], "state": "idle", "thread": None}
# A batch runs for hours and the UI only ever shows the tail, so the buffer is
# capped: an unbounded list here would grow for as long as the farm is up.
FARM_MAX_LINES = 500


def _farm_say(line) -> None:
    FARM["lines"].append(str(line))
    if len(FARM["lines"]) > FARM_MAX_LINES:
        del FARM["lines"][:-FARM_MAX_LINES]


def _farm_bits():
    from farm import farm as farmlib
    from farm.config import Config
    return farmlib, Config()


@app.get("/api/farm")
def api_farm():
    """Enough for the UI to decide whether to offer the farm at all."""
    try:
        farmlib, cfg = _farm_bits()
    except Exception as e:                                       # noqa: BLE001
        return jsonify(ready=False, why=f"farm/ is not installed: {e}", queued=0)

    checks = cfg.checklist()
    missing = cfg.missing_for_mac()
    queued = sorted(farmlib.QUEUE_DIR.glob("*.json"))
    out = {"ready": not missing, "why": "", "queued": len(queued), "checks": checks,
           "jobs": [], "state": FARM["state"], "lines": FARM["lines"][-40:],
           "max_pods": cfg.max_pods, "max_minutes": cfg.max_minutes,
           "gpu": cfg.gpu or cfg.cpu_flavour, "cloud": cfg.cloud}
    if missing:
        out["why"] = f"{sum(1 for c in checks if not c['ok'])} of {len(checks)} still to connect"
        return jsonify(**out)
    from farm import spec as jobspec
    for f in queued:
        try:
            j = jobspec.load(f)
        except (OSError, ValueError):
            continue
        out["jobs"].append({"slug": j.get("slug"), "title": j.get("title"),
                            "style": j.get("style"), "minutes": j.get("minutes"),
                            "words": len((j.get("script_text") or "").split())})
    return jsonify(**out)


@app.post("/api/farm/queue")
def api_farm_queue():
    """Add this video to the farm queue, script and all.

    The script is written HERE, through the Claude Code already signed in on this
    machine — free, and readable before a single pod is paid for.
    """
    try:
        farmlib, cfg = _farm_bits()
    except Exception as e:                                       # noqa: BLE001
        return jsonify(error=f"farm/ is not installed: {e}"), 400
    from farm import spec as jobspec

    d = request.get_json(force=True)
    titles = [t.strip() for t in (d.get("title") or "").splitlines() if t.strip()]
    if not titles:
        return jsonify(error="Give it at least one title — one per line."), 400
    style = d.get("style") or ""
    if style not in mv.prompts.PROMPT_SETS:
        return jsonify(error=f"No channel called '{style}'."), 400
    if _threed_on(style, {k: bool(v) for k, v in (d.get("features") or {}).items() if k in features.BY_KEY} or None):
        # the farm's machines have no graphics card: the 3D scenes render on this computer
        return jsonify(error="3D videos render on this computer's graphics card, and the render farm has none — "
                             "make this one here (switch the render farm off), or untick 3D scenes in Options."), 400
    if str(((styles.STYLES.get(style) or {}).get("look") or {}).get("visuals") or "") == "folio":
        # every FOLIO shot is drawn by Claude through the Claude Code signed in here; a rented machine would buy
        # each of those calls from the API instead, without the cache that keeps them cheap
        return jsonify(error="FOLIO draws every shot through the Claude Code signed in on this computer, and a farm "
                             "machine has no such login — make this one here (switch the render farm off)."), 400

    farmlib.QUEUE_DIR.mkdir(parents=True, exist_ok=True)
    queued, problems = [], []
    for title in titles:
        spec = jobspec.build(
            title, style,
            minutes=max(1, min(60, int(d.get("minutes") or 20))),
            script_text=(d.get("script") or "").strip(),
            extra=(d.get("extra") or "").strip()[:4000],
            thumb_count=max(1, min(4, int(d.get("thumb_count") or 2))),
            burn_subs=bool(d.get("burn_subs", True)),
            force=bool(d.get("force", False)),
            character=(d.get("character") or "").strip()[:4000],
            features={k: bool(v) for k, v in (d.get("features") or {}).items()
                      if k in features.BY_KEY} or None,
            avatar_id=(d.get("avatar_id") or "").strip()[:64],
            avatar_s=max(0.0, min(float(d.get("avatar_s") or 0), 15.0)),
            avatar_count=max(1, min(int(d.get("avatar_count") or 1), avatar.MAX_COUNT)),
            steps=["video", "thumbnail"] if d.get("thumb", True) else ["video"])
        done = farmlib.finished_already(spec["slug"])
        if done is not None and not spec.get("force"):
            problems.append(f"{title}: already made — output/{spec['slug']}/{done.name}. "
                            "Preparing it again would clear that job's voice and stills; "
                            "change the title, or tick Redo everything.")
            continue
        if not spec["script_text"]:
            spec["script_text"] = farmlib.write_script_here(spec)
        bad = jobspec.problems(spec)
        # The pod gets its keys from this .env. Without both, the presenter step on
        # the pod would skip itself and the video would come back without one —
        # say so now, before a machine is paid for.
        if spec.get("avatar_s") and not (features.capabilities()["features"]
                                         .get("avatar") or {}).get("ok"):
            bad.append("the AI presenter needs KIE_API_KEY and WAVESPEED_API_KEY in .env")
        if bad:
            problems.append(f"{title}: {'; '.join(bad)}")
            continue
        jobspec.save(spec, farmlib.QUEUE_DIR / f"{spec['slug']}.json")
        queued.append({"slug": spec["slug"], "title": title,
                       "words": len(spec["script_text"].split())})
    return jsonify(queued=queued, problems=problems)


@app.post("/api/farm/run")
def api_farm_run():
    """Rent the machines. One video each, and each switches itself off."""
    if FARM["thread"] and FARM["thread"].is_alive():
        return jsonify(error="The farm is already running."), 400
    try:
        farmlib, cfg = _farm_bits()
    except Exception as e:                                       # noqa: BLE001
        return jsonify(error=f"farm/ is not installed: {e}"), 400
    from farm import spec as jobspec

    jobs = [jobspec.load(f) for f in sorted(farmlib.QUEUE_DIR.glob("*.json"))]
    if not jobs:
        return jsonify(error="Nothing in the farm queue."), 400
    pods = max(1, min(int((request.get_json(silent=True) or {}).get("pods") or 0)
                      or cfg.max_pods, cfg.max_pods))

    FARM.update(lines=[], state="running")

    def work():
        try:
            farmlib.run_queue(cfg, jobs, pods, sink=_farm_say)
            FARM["state"] = "done"
        except Exception as e:                                   # noqa: BLE001
            _farm_say(f"farm stopped: {e}")
            FARM["state"] = "failed"

    FARM["thread"] = threading.Thread(target=work, daemon=True)
    FARM["thread"].start()
    return jsonify(started=len(jobs), pods=pods)


def _bucket_part(part: str) -> bool:
    """Is this safe to put inside a bucket key?

    SAFE (the guard for local filenames) rejects spaces, and a finished video is
    named after its title — "The Ford Edsel.mp4", "Tajný život.mp4". So the test
    here is not which characters are allowed but whether the name can escape the
    folder it belongs to: no separators, no dot-segments, nothing hidden.
    """
    part = (part or "").strip()
    return bool(part) and part not in (".", "..") and not part.startswith(".") \
        and "/" not in part and "\\" not in part and "\x00" not in part


@app.get("/api/farm/library")
def api_farm_library():
    """Everything the farm has finished, read from the bucket itself.

    Not from this computer's memory of it: a pod uploads and then deletes
    itself, so the bucket is the only place that knows what exists.
    """
    try:
        farmlib, cfg = _farm_bits()
        from farm.config import bucket_from
        rows = farmlib.library(bucket_from(cfg))
    except Exception as e:                                       # noqa: BLE001
        return jsonify(error=str(e)[:200], videos=[]), 200
    return jsonify(videos=rows, bucket=cfg.bucket,
                   total=sum(r["bytes"] for r in rows))


@app.get("/api/farm/file/<slug>/<name>")
def api_farm_file(slug, name):
    """Hand the browser a signed link and get out of the way.

    Streaming a gigabyte through Flask would be slower and would hold a worker
    for the whole download; a signed link lets the browser take it straight
    from the bucket at full speed. It stops working after six hours.
    """
    if not (_bucket_part(slug) and _bucket_part(name)):
        return jsonify(error="bad name"), 400
    try:
        _, cfg = _farm_bits()
        from farm.config import bucket_from
        url = bucket_from(cfg).presign(f"out/{slug}/{name}", seconds=6 * 3600)
    except Exception as e:                                       # noqa: BLE001
        return jsonify(error=str(e)[:200]), 400
    return redirect(url, code=302)


@app.post("/api/farm/fetch/<slug>")
def api_farm_fetch(slug):
    """Copy one finished video down into output/, the same place a local render
    puts it — for when you would rather have it on disk than in a browser."""
    if not _bucket_part(slug):
        return jsonify(error="bad name"), 400
    try:
        farmlib, cfg = _farm_bits()
        from farm.config import bucket_from
        bucket = bucket_from(cfg)
        got = []
        rows = [r for r in farmlib.library(bucket) if r["slug"] == slug]
        job = mv.find_job(slug)
        if job is None:
            # no folder here yet: the pod's own title and channel say where it belongs
            import tempfile
            tmp = Path(tempfile.mkdtemp(prefix="frontier-pull-"))
            for r in rows:
                for f in r["files"]:
                    if f["name"] in ("title.txt", "style.txt"):
                        bucket.get_file(f"out/{slug}/{f['name']}", tmp / f["name"])
            first = lambda n: (tmp / n).read_text(encoding="utf-8").splitlines()[0].strip() if (tmp / n).exists() else ""
            job = OUT / mv.style_folder(first("style.txt")) / mv.WORK_DIR / slug
        job.mkdir(parents=True, exist_ok=True)
        pub = mv._published(job)
        video_name = ""
        for row in rows:
            for f in row["files"]:
                if not _bucket_part(f["name"]):
                    continue        # a key that would write outside the video's folder
                dest = job / f["name"]
                if f["name"].lower().endswith((".mp4", ".mov")):
                    video_name = f["name"]
                    up = mv.main_dir(job) / f["name"]
                    if pub.get("video") == f["name"] and up.exists() and up.stat().st_size == f["size"]:
                        continue    # already down and in its folder
                if dest.exists() and dest.stat().st_size == f["size"]:
                    continue
                bucket.get_file(f"out/{slug}/{f['name']}", dest)
                got.append(f["name"])
        t = job / "title.txt"
        title = t.read_text(encoding="utf-8").splitlines()[0] if t.exists() else \
            (Path(video_name).stem if video_name else slug)
        # the video up into its folder, with its description — the render that just came down, never an older one
        mv.publish_named_copy(job, title, fresh=video_name if video_name in got else "")
    except Exception as e:                                       # noqa: BLE001
        return jsonify(error=str(e)[:200]), 400
    return jsonify(fetched=got, into=str(mv.main_dir(job)))


@app.post("/api/farm/forget/<slug>")
def api_farm_forget(slug):
    """Delete one job from the bucket. Nothing on this computer is touched."""
    if not _bucket_part(slug):
        return jsonify(error="bad name"), 400
    try:
        farmlib, cfg = _farm_bits()
        from farm.config import bucket_from
        bucket = bucket_from(cfg)
        gone = 0
        for row in farmlib.library(bucket):
            if row["slug"] != slug:
                continue
            for f in row["files"]:
                bucket.delete(f"out/{slug}/{f['name']}")
                gone += 1
    except Exception as e:                                       # noqa: BLE001
        return jsonify(error=str(e)[:200]), 400
    return jsonify(deleted=gone)


@app.post("/api/farm/kill")
def api_farm_kill():
    """The panic button. Switches every farm pod off and says what is left."""
    try:
        _, cfg = _farm_bits()
        from farm.runpod import RunPod
        rp = RunPod(cfg.runpod_key)
        pods = [p for p in rp.list() if str(p.get("name", "")).startswith(cfg.prefix)]
        left = [p for p in pods if not rp.terminate(p["id"])]
    except Exception as e:                                       # noqa: BLE001
        return jsonify(error=str(e)), 400
    FARM["state"] = "idle"
    _farm_say(f"kill: {len(pods) - len(left)} off, {len(left)} would not stop")
    return jsonify(killed=len(pods) - len(left),
                   left=[p.get("name") for p in left])


@app.get("/api/avatars")
def api_avatars():
    """The presenter library, and which half of it this channel should show first.

    A channel states the sex of its narrator in `voice.gender`; the UI leads with
    the matching faces because a man's voice under a woman's face reads as broken
    long before anyone works out why. Channels that do not say get everyone."""
    try:
        import avatar
    except Exception as e:                                       # noqa: BLE001
        return jsonify(avatars=[], gender="", error=str(e)[:200])
    st = styles.STYLES.get((request.args.get("style") or "").strip()) or {}
    gender = ((st.get("voice") or {}).get("gender") or "").strip().lower()
    rows = avatar.library()
    return jsonify(avatars=[{k: r[k] for k in ("id", "gender", "niches", "persona")} for r in rows],
                   gender=gender if gender in ("male", "female") else "",
                   seconds={"min": avatar.MIN_SECONDS, "max": avatar.MAX_SECONDS, "default": 8},
                   count={"min": 1, "max": avatar.MAX_COUNT, "default": 1},
                   per_second=avatar.PROVIDERS[avatar.DEFAULT_PROVIDER]["usd_s"])


@app.get("/api/avatars/<aid>.png")
def api_avatar_png(aid):
    """One presenter's portrait. The id is matched against the library rather than
    joined onto a path, so nothing outside it can be reached."""
    try:
        import avatar
    except Exception:                                            # noqa: BLE001
        return Response("no avatar module", status=404, mimetype="text/plain")
    for r in avatar.library():
        if r["id"] == aid:
            return send_file(r["file"], mimetype="image/png")
    return Response("unknown avatar", status=404, mimetype="text/plain")


@app.get("/")
def index():
    if not UI.exists():
        return Response("ui.html is missing next to app.py", mimetype="text/plain")
    return Response(UI.read_text(encoding="utf-8"), mimetype="text/html")


def _open_browser():
    time.sleep(0.8)
    try:
        webbrowser.open(f"http://127.0.0.1:{PORT}/")
    except Exception:                                            # noqa: BLE001
        pass


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    print("\n  FRONTIER")
    print(f"  channels: {', '.join(LOADED) if LOADED else 'none yet — see CLAUDE.md'}")
    print(f"  http://127.0.0.1:{PORT}/\n")
    _ensure_dispatcher()
    if not os.environ.get("FRONTIER_NO_BROWSER"):
        threading.Thread(target=_open_browser, daemon=True).start()
    app.run(host="127.0.0.1", port=PORT, threaded=True, debug=False)
