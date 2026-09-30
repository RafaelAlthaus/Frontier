"""FOLIO — a whole video drawn in code (`look.visuals: "folio"`).

An animated history explainer in the manner of a moving picture book: every shot is an illustration
that Claude writes as a small program against the FOLIO runtime (`assets/folio/*.js`) — parallax planes,
a camera, depth of field, a visible key light, the same cast in every shot, cream-paper diagrams, serif
labels on their spoken words — rendered frame by frame in Chromium and joined with camera-driven
transitions. No footage, no stock, no AI pictures. The look the prompts follow is `assets/folio/LOOK.md`;
`README-FOLIO.md` explains the channel.

Frontier calls it through the visuals-plugin hook (`make_video._visuals_plugin`):
    prepare(engine, script, job, style, force)      — beside the voiceover: cast + shot list + programs
    assemble(engine, job, mp3, srt, style, force, burn_subs) → video.mp4

Developer tools (no Frontier job needed):
    python folio.py still  <program.js> [--dur 6] [--t 0,2,4] [--words words.json] [--out dir]
    python folio.py render <program.js> [--dur 6] [--out shot.mp4]
    python folio.py check                      — every runtime file loads, a demo shot renders
    python folio.py redo <job folder> --t s07 --note "…"   — redraw one shot with a note on the next assemble
"""
from __future__ import annotations

import base64
import contextlib
import io
import json
import os
import re
import shutil
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
ASSETS = HERE / "assets" / "folio"
FONTS = ASSETS / "fonts"
RUNTIME = ["core.js", "fx.js", "hud.js", "diagram.js", "people.js", "sets.js", "props.js"]
W, H = 1920, 1080
FPS = int(os.environ.get("FPS", "30"))
WORKERS = max(1, min(2, int(os.environ.get("FOLIO_WORKERS", "2"))))   # never more than two Chromiums


# ── the page ──────────────────────────────────────────────────────────────────────────
_FONT_FACES = [
    ("EB Garamond", "EBGaramond.ttf", "400 800", "normal"),
    ("EB Garamond", "EBGaramond-Italic.ttf", "400 800", "italic"),
    ("Nunito", "Nunito.ttf", "200 1000", "normal"),
]
_CACHE: dict = {}


def _font_css() -> str:
    if "fonts" not in _CACHE:
        css = []
        for fam, name, wt, st in _FONT_FACES:
            f = FONTS / name
            if f.exists():
                css.append(f"@font-face{{font-family:'{fam}';font-style:{st};font-weight:{wt};"
                           f"src:url(data:font/ttf;base64,{base64.b64encode(f.read_bytes()).decode()});font-display:block}}")
        _CACHE["fonts"] = "\n".join(css)
    return _CACHE["fonts"]


def _runtime_js() -> str:
    """The runtime files, in order; a missing optional file is skipped (core.js is required)."""
    parts = []
    for name in RUNTIME:
        f = ASSETS / name
        if f.exists():
            parts.append(f"/* ── {name} ── */\n" + f.read_text(encoding="utf-8"))
        elif name == "core.js":
            raise FileNotFoundError(f"FOLIO runtime missing: {f}")
    return "\n".join(parts)


PAGE = r"""<!doctype html><html><head><meta charset="utf-8"><style>
__FONTS__
html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#000}
#stage{position:absolute;left:0;top:0;width:1920px;height:1080px;overflow:hidden;background:__GROUND__}
#under,#frame,#world,#fx,#hud,#edge,#top{position:absolute;left:0;top:0;width:1920px;height:1080px;pointer-events:none}
#frame{overflow:hidden;background:__GROUND__}
#world{overflow:hidden}
#under{display:none}
.layer{position:absolute;left:0;top:0;width:1920px;height:1080px;transform-origin:0 0;will-change:transform}
.layer svg{position:absolute;left:0;top:0;overflow:visible}
.abs{position:absolute}
.serif{font-family:'EB Garamond',Georgia,serif;font-weight:400;font-variant-numeric:oldstyle-nums proportional-nums;
  font-kerning:normal;text-rendering:geometricPrecision}
.sans{font-family:'Nunito',Arial,sans-serif;font-weight:800;font-variant-numeric:lining-nums tabular-nums}
</style></head><body><div id="stage"></div>
<script>
window.__ready = false; window.__err = "";
window.onerror = (m, s, l, c, e) => { window.__err = String((e && e.stack) || m).slice(0, 1200); window.__ready = true; };
window.FOLIO = { fonts: async () => {
  const faces = ['400 40px "EB Garamond"', 'italic 400 40px "EB Garamond"', '500 40px "EB Garamond"',
                 '800 40px "Nunito"', '700 40px "Nunito"', '400 40px "Nunito"'];
  await Promise.all(faces.map(f => document.fonts.load(f, "Aa1ěš")));
  await document.fonts.ready;
} };
</script>
<script>
__RUNTIME__
</script>
<script>
const SCENE = __SCENE__;
</script>
<script>
try {
__PROGRAM__
} catch (e) { window.__err = String((e && e.stack) || e).slice(0, 1200); }
</script>
<script>
(async () => { if (!window.__err) await FOLIO.boot(SCENE); window.__ready = true; })();
</script>
</body></html>"""


def build_page(program: str, scene: dict) -> str:
    ground = str(scene.get("ground") or "#000")
    if not re.fullmatch(r"#[0-9a-fA-F]{3,8}|[a-z]+", ground):
        ground = "#000"
    # </script> inside the program or the JSON would end the tag early
    safe = lambda s: s.replace("</script", "<\\/script")
    return (PAGE.replace("__FONTS__", _font_css())
                .replace("__GROUND__", ground)
                .replace("__RUNTIME__", safe(_runtime_js()))
                .replace("__SCENE__", safe(json.dumps(scene, ensure_ascii=False)))
                .replace("__PROGRAM__", safe(program)))


# ── one render at a time on this machine ────────────────────────────────────────────────
@contextlib.contextmanager
def render_lock(name: str = "folio"):
    """A machine-wide lock around every Chromium render (several headless renders at once have
    frozen a Mac). FOLIO_LOCK names the lock file; on the machine that also runs the 3D renderer its
    lock is shared, so FOLIO never renders beside it."""
    path = os.environ.get("FOLIO_LOCK") or ""
    if not path:
        shared = Path.home() / "pharos3d" / ".gpu.lock"
        path = str(shared if shared.parent.is_dir() else Path.home() / ".frontier" / "render.lock")
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    f = open(path, "a+", encoding="utf-8")
    note = os.name != "nt"          # Windows will not let the waiting side read a byte the holder has locked
    said = False
    while not _flock(f, True):
        if not said:
            who = ""
            if note:
                with contextlib.suppress(OSError):
                    f.seek(0)
                    who = f.read().strip()
            print(f"[folio] waiting for the render lock ({(who or 'another render')[:80]})", file=sys.stderr, flush=True)
            said = True
        time.sleep(2)
    _wait_memory(name)
    try:
        if note:
            f.seek(0); f.truncate(); f.write(f"{name} pid {os.getpid()} since {time.strftime('%H:%M:%S')}\n"); f.flush()
        yield
    finally:
        if note:
            with contextlib.suppress(OSError):
                f.seek(0); f.truncate(); f.flush()
        _flock(f, False)
        f.close()


def _flock(f, lock: bool) -> bool:
    """Take (without waiting) or release the lock on an open lock file: flock on macOS and Linux, the file's
    first byte on Windows. False when another process holds it."""
    try:
        if os.name == "nt":
            import msvcrt
            f.seek(0)
            msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK if lock else msvcrt.LK_UNLCK, 1)
        else:
            import fcntl
            fcntl.flock(f, (fcntl.LOCK_EX | fcntl.LOCK_NB) if lock else fcntl.LOCK_UN)
        return True
    except OSError:
        return False


def _wait_memory(name: str) -> None:
    """macOS: never start a render into a squeezed machine (critical pressure always waits; warning
    waits unless at least 30 % of memory is free)."""
    if sys.platform != "darwin":
        return
    for _ in range(360):
        try:
            lv = int(subprocess.run(["sysctl", "-n", "kern.memorystatus_vm_pressure_level"], capture_output=True,
                                    text=True, timeout=10).stdout.strip() or 1)
        except (OSError, ValueError, subprocess.SubprocessError):
            return
        if lv <= 1:
            return
        if lv == 2:
            try:
                out = subprocess.run(["memory_pressure"], capture_output=True, text=True, timeout=20).stdout
                free = int(re.search(r"free percentage:\s*(\d+)", out).group(1))
                if free >= 30:
                    return
            except (OSError, AttributeError, ValueError, subprocess.SubprocessError):
                return
        print(f"[folio] {name}: memory pressure high (level {lv}), waiting", file=sys.stderr, flush=True)
        time.sleep(5)


# ── frames ──────────────────────────────────────────────────────────────────────────────
def _launch(pw):
    args = ["--force-color-profile=srgb", "--font-render-hinting=none", "--disable-lcd-text"]
    if os.environ.get("FOLIO_GPU", "") != "1":
        args.append("--disable-gpu")
    return pw.chromium.launch(args=args)


def _open(browser, html: str, tmpdir: Path):
    """Load a page from a file (a big data-URI page through set_content is slow) and wait for __ready."""
    tmpdir.mkdir(parents=True, exist_ok=True)
    f = tmpdir / f"page_{os.getpid()}_{time.time_ns()}.html"
    f.write_text(html, encoding="utf-8")
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.goto(f.as_uri(), wait_until="load")
    page.wait_for_function("window.__ready===true", timeout=120000)
    err = page.evaluate("window.__err||''")
    with contextlib.suppress(OSError):          # Windows: the browser may still hold the file open
        f.unlink(missing_ok=True)
    return page, err


def _shot(page, t: float, sub: int, fps: int, quality: int = 93):
    """One output frame at time t: one screenshot, or `sub` sub-frames over a 180° shutter averaged."""
    if sub <= 1:
        page.evaluate("(t)=>window.renderFrame(t)", t)
        return page.screenshot(type="jpeg", quality=quality, clip={"x": 0, "y": 0, "width": W, "height": H})
    import numpy as np
    from PIL import Image
    acc = None
    for j in range(sub):
        page.evaluate("(t)=>window.renderFrame(t)", t + (j / sub - 0.25) * (1.0 / fps))
        raw = page.screenshot(type="jpeg", quality=95, clip={"x": 0, "y": 0, "width": W, "height": H})
        a = np.asarray(Image.open(io.BytesIO(raw)).convert("RGB"), dtype=np.float32)
        acc = a if acc is None else acc + a
    buf = io.BytesIO()
    Image.fromarray((acc / sub + 0.5).astype("uint8")).save(buf, "JPEG", quality=quality)
    return buf.getvalue()


def render_shot(program: str, scene: dict, out: Path, fps: int = FPS, browser=None, tmpdir: Path = None,
                log=print) -> Path:
    """One shot → mp4 (all its frames, handles included). `scene["dur"]` is the rendered length."""
    out = Path(out)
    tmpdir = Path(tmpdir or out.parent / "_pages")
    n = max(1, int(round(float(scene["dur"]) * fps)))
    part = out.with_suffix(".part.mp4")
    own = browser is None
    pw = None
    if own:
        from playwright.sync_api import sync_playwright
        pw = sync_playwright().start()
        browser = _launch(pw)
    try:
        page, err = _open(browser, build_page(program, scene), tmpdir)
        if err:
            page.close()
            raise RuntimeError(f"{scene.get('id', 'shot')}: {err}")
        ff = subprocess.Popen(["ffmpeg", "-y", "-loglevel", "error", "-f", "image2pipe", "-c:v", "mjpeg",
                               "-framerate", str(fps), "-i", "-", "-c:v", "libx264", "-preset", "veryfast",
                               "-crf", "12", "-pix_fmt", "yuv420p", "-color_range", "tv", "-r", str(fps), str(part)],
                              stdin=subprocess.PIPE)
        try:
            for k in range(n):
                t = k / fps
                sub = int(page.evaluate("(t)=>window.__shutter(t)", t) or 1)
                ff.stdin.write(_shot(page, t, min(max(sub, 1), 8), fps))
                if k == 0 or k == n - 1:
                    err = page.evaluate("window.__err||''")
                    if err:
                        raise RuntimeError(f"{scene.get('id', 'shot')} at {t:.2f}s: {err}")
        finally:
            ff.stdin.close()
            ok = ff.wait() == 0
            page.close()
        if not ok:
            raise RuntimeError(f"ffmpeg failed on {out.name}")
        part.replace(out)
        return out
    finally:
        if own:
            browser.close()
            pw.stop()


def stills(program: str, scene: dict, times: list, out_dir: Path, prefix: str = "still", scale: float = 1.0) -> list:
    """PNG stills of a shot at the given times — for checking a shot by eye before it renders."""
    from playwright.sync_api import sync_playwright
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    paths = []
    with render_lock(f"folio stills {scene.get('id', '')}"):
        with sync_playwright() as pw:
            browser = _launch(pw)
            page, err = _open(browser, build_page(program, scene), out_dir / "_pages")
            if err:
                browser.close()
                raise RuntimeError(err)
            for t in times:
                page.evaluate("(t)=>window.renderFrame(t)", float(t))
                p = out_dir / f"{prefix}_{float(t):06.2f}.png"
                page.screenshot(path=str(p), clip={"x": 0, "y": 0, "width": W, "height": H})
                err = page.evaluate("window.__err||''")
                if err:
                    browser.close()
                    raise RuntimeError(f"at {t}: {err}")
                if scale != 1.0:
                    from PIL import Image
                    im = Image.open(p)
                    im.resize((int(W * scale), int(H * scale)), Image.LANCZOS).save(p)
                paths.append(p)
            browser.close()
    return paths


# ════════════════════════════════════════════════════════════════════════════════════════
# THE FILM — director, illustrator, editor
# ════════════════════════════════════════════════════════════════════════════════════════
MODEL = os.environ.get("FOLIO_MODEL", "claude-opus-5-5")       # the illustrator: it draws every shot in code
LEAD_IN = 0.8          # seconds of picture before the first word (the reference speaks at 0.96 s)
TAIL = 3.0             # music and the end title after the last word
WPM = 162              # the reference's pace, for estimates before the voice exists


def _cfg(engine, style: str) -> dict:
    look = ((engine.STYLE_INFO.get(style) or {}).get("look") or {}) if engine is not None else {}
    return dict(look.get("folio") or {})


def _headers() -> str:
    """The API every shot program may use: the header comment of each runtime file, in order."""
    out = []
    for name in RUNTIME:
        f = ASSETS / name
        if not f.exists():
            continue
        m = re.match(r"\s*/\*(.*?)\*/", f.read_text(encoding="utf-8"), re.S)
        if m:
            out.append(f"── {name} ──\n" + re.sub(r"^\s*\* ?", "", m.group(1), flags=re.M).strip())
    return "\n\n".join(out)


def _examples(n: int = 3) -> str:
    """A few finished shot programs, shown to the illustrator as the standard to meet."""
    ex = sorted((ASSETS / "examples").glob("shot_*.js"))[:n]
    return "\n\n".join(f"// ── example: {p.stem} ──\n" + p.read_text(encoding="utf-8").strip() for p in ex)


def _bible() -> str:
    """The look every prompt follows: the picture, type, camera and transitions (`assets/folio/LOOK.md`)."""
    f = ASSETS / "LOOK.md"
    if not f.exists():
        return ""
    txt = f.read_text(encoding="utf-8")
    keep = []
    for sec in re.split(r"\n(?=## )", txt):
        if sec.startswith(("## 4.", "## 5.", "## 6.", "## 7.")):
            keep.append(sec.strip())
    return "\n\n".join(keep)


STORYBOARD_PROMPT = """You are the director of FOLIO, an animated history-and-science explainer channel. Every frame of
a FOLIO video is an illustration drawn in code: flat vector shapes with soft gradients, one warm visible key light,
depth of field, cartoon people with big eyes who keep the same look all film, small serif labels, and engineering
diagrams on cream paper ("Fig. 1"). No footage, no photos, no captions.

Turn the narration below into a SHOT LIST for this video — the storyboard an illustrator will draw from.

THE LOOK (measured off the reference film)
[INSERT BIBLE HERE]

WHAT THE ILLUSTRATOR CAN DRAW (the runtime's library — plan shots it can actually make)
[INSERT HEADERS HERE]

RULES
- A new shot every 3 to 6 seconds of narration (never under 1.6 s, never over 9 s). Cut where a sentence or a clause
  starts. Every shot shows what its words say — the object, the person, the place of the sentence. A sentence with a
  number gets the number on screen; a sentence that explains how something works gets a paper diagram (Fig. n).
- Open like the reference: the present day with a striking number, then jump into the past. End on the last line
  with the end title card (the subject's name and its year) over a picture that closes the story.
- The first time a place or a year appears: a place label (and the year above it). The first time a person
  appears: their name beside them. A thing made of parts: callouts on the parts. A measured quantity (time,
  distance, count): a chip or a counter. A quote: a quote card. Things that were wrong: struck through in red.
- Words on screen claim nothing the narration does not say: no extra facts, no invented figures, no taglines. A
  sub-line may only give a place's modern name or a date the narration implies. At most two text elements in a
  shot under 4 seconds, three in a longer one — the picture carries the rest.
- The camera is locked most of the time; a move needs a reason (follow, push in on a realisation, pull back to
  reveal). Transitions come from this vocabulary, chosen for a reason:
  cut (on an action) · dissolve (quiet) · bloom (warm light, time passing, memory) · whiteout (into the sky/clouds,
  a jump across centuries) · push (the camera flies into an object, a window, a box — the inside is the next shot) ·
  whip (a fast sideways jump to another place of the same story) · tilt (up to the sky or down to the ground) ·
  cover (a paper sheet slides up over the scene — into a diagram) · reveal (the sheet slides away — back to a scene) ·
  wipe (a wall panel slides in — a new interior) · defocus (the picture goes soft while the next drawing starts).
- People: define every recurring person ONCE in "cast" with the fields of S.person's def (people.js), true to the
  period and the person (age, hair, beard, clothes, colours). Crowds and passers-by need no cast entry.
- Be concrete: name the setting (which S.set / S.prop pieces), the time of day and the key light, who is where and
  what they do, which object is the hero, what the camera does, and which words land on which spoken words.

Return ONLY a JSON object:
{"cast": {"<id>": {<person def>}},
 "shots": [{"id": "s01",
            "from": "<the first 3 to 6 words of this shot's narration, copied EXACTLY from the script>",
            "picture": "<what we see: setting, light, people and what they do, the hero object, foreground/background>",
            "camera": "<locked | slow push-in on … | follow … | pull back to reveal … >",
            "text": ["<each on-screen element and the spoken word it lands on, e.g. place 'Alexandria' + year 'c. 240 BC' on 'Alexandria'>"],
            "out": {"kind": "<transition out of this shot>", "dir": "<left|right|up|down, for whip/tilt>"},
            "sound": "<the one or two sounds of this place, or none>"}]}
The shots must cover the narration you are given in order, every word once. A long film comes in parts: you get
one part at a time with the cast so far — reuse those people exactly, add a new person only when the narration
brings one in. Only the film's first part opens on the present-day number; only its last part ends on the title card,
and the last shot of the last part has "out": "cut"."""


STORYBOARD_USER = """TITLE: [INSERT TITLE HERE]
[INSERT PART HERE]
THE CAST SO FAR (reuse these exact definitions; add only new people):
[INSERT CAST HERE]

NARRATION (each sentence with the second it starts, roughly):
[INSERT LINES HERE]

Number the shots from [INSERT FIRST ID HERE]. Reply with ONLY the JSON object."""


# The illustrator's instructions are split in two. DRAW_SYSTEM is the same for every shot of every video (the look,
# the whole runtime API, the craft rules, the finished examples, ~24 k tokens): it goes in as the SYSTEM prompt, which the
# Claude Code login caches for an hour, so after the first shot every drawing, fix and rework reads it from the cache at
# a tenth of the price. The user message carries only what is new — the shot, its words, its neighbours (~2 k tokens).
# Measured on the sample: $0.31 per shot drawing before, $0.055 after (Opus 5.5 list prices).
DRAW_SYSTEM = """You are the illustrator-animator of FOLIO. You draw shots of an animated explainer film as JavaScript
programs for the FOLIO runtime (SVG in Chromium, one screenshot per frame, 1920×1080, 30 fps). You return ONLY what is
asked — a complete program, no fences, no explanation, no preamble.

THE LOOK (measured off the reference film — match it)
[INSERT BIBLE HERE]

THE RUNTIME API (everything you may call)
[INSERT HEADERS HERE]

HOW A SHOT IS WRITTEN
- The whole program is one call: FOLIO.scene({ build(S) { … } });  Inside build you create layers, draw, and register
  animation. Everything on screen must be a pure function of time t: use S.on(t => …), S.tw(t0, t1, p => …),
  S.fade(…), FOLIO.keys, and the library's own `at` options. Never Math.random (use S.rnd() or FOLIO.rnd(seed)),
  never Date, setTimeout, requestAnimationFrame or CSS animations/transitions.
- Time: S.dur is this shot's length in seconds. Words arrive at S.at("phrase") (seconds, the first word of the
  phrase) — put every label, gesture and reveal on its word. Nothing important in the first 0.3 s or the last 0.3 s.
- Depth: 3 to 5 layers. A far layer p 0.15–0.4 (sky, far city), a middle layer p 0.6–0.85, the subject plane p 1,
  and often a foreground layer p 1.3–1.7 with blur 8–18 (grass, a lamp post, a railing, a table edge). Close-ups
  blur the background layer (blur 6–14). Backgrounds that fill the frame use the library (they cover camera moves).
- Light: one warm visible key light — a lamp with S.glow + S.motes, or a window with S.rays + S.motes, or the sun
  with a haze toward the horizon. Interiors warm, exteriors high-key.
- People only through S.person(S.cast.<id>, layer, {...}) with the cast definition you are given — the same person
  must look the same in every shot. Give them something to do on the words (walk in, point, raise, look, think).
  A seated person needs something to sit on (P.seatAt gives the seat), a held thing needs a hand (P.hand).
- Use S.set.* and S.prop.* first. Draw custom SVG only for what the library lacks, in the same style: flat shapes,
  each fill a soft two-stop gradient (FOLIO.lg), outlines in FOLIO.ink(fill) (never black), one shadow side.
- Words on screen only through the hud/diagram functions, placed on their spoken words; never repeat the narration
  as text; keep text clear of faces and of the frame edge (60 px margin). Light text needs a darker picture behind
  it and dark text a light one — never pale type on a pale sky or thin type on a busy ground.
- COMPOSITION — work it out before you draw. The hero of the shot must be seen whole and at once: big enough (a
  person 450–700 px tall, an object at least a fifth of the frame), near a third of the frame, nothing in front of it.
  Foreground layers (p > 1) only FRAME the picture: keep them inside the outer ~18 % of the frame (a column edge, a
  corner of a table, grass along the bottom) and never across the hero. Remember what a layer shows on screen: a
  point x on a layer of parallax p lands at 960 + (x − cam.x·p − 960·(1 − p))·(1 + (zoom − 1)·p). Sizes you pass
  are sizes in the world: a column is about a fifth as wide as it is tall, a person's h is their full height.
- A diagram on paper must SHOW its point big and early: the angle, the arrow, the number the sentence is about,
  drawn large enough to read at a glance and complete a second before the shot ends.
- A stage (S.set.stage) already has its sky, sun or moon, and ground — read its notes in the header and use its
  returned layers and floor; don't paint a second light on top of something it drew.
- Camera: S.cam([...]) keys. Locked or a slow push (≤ 5 % over the shot) unless the storyboard asks for a move; a
  move uses smooth easing and keeps the subject framed. The shot's transitions (SCENE in/out) are applied by the
  runtime — do not animate them yourself.
- Keep it light enough to render: under ~1,500 SVG elements, no per-frame element creation.

Examples of finished shots (the standard to meet — not templates to copy):
[INSERT EXAMPLES HERE]"""


DRAW_USER = """THE CAST (use these exact definitions: S.cast.<id>)
[INSERT CAST HERE]

THIS SHOT
[INSERT SHOT HERE]

Its narration, word by word with the second each word starts in this shot (the shot is [INSERT DUR HERE] s long):
[INSERT WORDS HERE]

The shot before: [INSERT PREV HERE]
The shot after: [INSERT NEXT HERE]

Draw this shot. Reply with ONLY the JavaScript program."""


FIX_PROMPT = """This FOLIO shot program failed. Fix it and reply with ONLY the complete corrected program.

THE ERROR
[INSERT ERROR HERE]

THE PROGRAM
[INSERT CODE HERE]"""


REVIEW_SYSTEM = """You are the art director of FOLIO, an illustrated explainer film in the style of a moving picture book
(flat vector shapes with soft gradients, warm light, depth of field, cartoon people with big eyes, small serif labels,
cream-paper diagrams). You look at three frames of one shot — its start, middle and end — and judge them as the picture
a viewer will see. Its transitions in and out (whiteouts, blooms, blur, slides) are added by the runtime around these
frames: judge the drawing, not the transition.

Check it hard:
1. Is the subject there and readable at a glance? Anything important cut off by the frame edge?
2. Broken drawing: shapes floating in the air, people floating above the ground or sunk into it, a seated person with
   nothing under them, limbs detached, parts drawn outside the object, a large empty or black area, an unfinished
   background, text overlapping text or a face.
3. Does it look like one illustration (consistent light, perspective and scale) and like the look described?
4. Words on screen: spelled right, legible, not repeating the narration, placed on the right thing.

Reply with ONLY a JSON object: {"ok": true|false, "problems": ["<concrete problem and where>", ...]}
Say ok:false only for problems a viewer would notice; list at most 5."""


REVIEW_PROMPT = """The shot was meant to show: [INSERT SHOT HERE]"""


REWORK_PROMPT = """This FOLIO shot program renders, but the art director found problems in its frames — the image
shows the shot's start, middle and end as it renders now. Look at it, find the cause of every problem in the code
(sizes, positions, layers, parallax, timing) and fix it; keep what works. Reply with ONLY the complete corrected program.

PROBLEMS
[INSERT PROBLEMS HERE]

THE SHOT
[INSERT SHOT HERE]

THE PROGRAM
[INSERT CODE HERE]"""


# ── helpers ─────────────────────────────────────────────────────────────────────────────
def _log(engine, msg: str) -> None:
    (engine.log if engine is not None else print)(msg)


def _json_from(text: str):
    t = re.sub(r"^```[a-zA-Z]*\s*|```\s*$", "", (text or "").strip(), flags=re.M).strip()
    for a, b in (("{", "}"), ("[", "]")):
        i, j = t.find(a), t.rfind(b)
        if 0 <= i < j:
            try:
                return json.loads(t[i:j + 1])
            except ValueError:
                continue
    return None


def _code_from(text: str) -> str:
    t = (text or "").strip()
    m = re.search(r"```(?:js|javascript)?\s*\n(.*?)```", t, re.S)
    if m:
        t = m.group(1).strip()
    i = t.find("FOLIO.scene")
    return t[i:].strip() if i > 0 and "FOLIO.scene" in t else t


def _norm(w: str) -> str:
    import unicodedata
    w = unicodedata.normalize("NFKD", str(w).lower())
    return re.sub(r"[^a-z0-9]", "", "".join(c for c in w if not unicodedata.combining(c)))


def _sentences(script: str) -> list:
    return [s.strip() for s in re.split(r"(?<=[.!?…])\s+", script.strip()) if s.strip()]


import threading
_SPEND = {"usd": 0.0, "calls": 0, "cache_read": 0, "cache_write": 0, "out": 0, "by": {}}
_SPEND_LOCK = threading.Lock()


def _draw_system() -> str:
    if "draw_system" not in _CACHE:
        _CACHE["draw_system"] = (DRAW_SYSTEM.replace("[INSERT BIBLE HERE]", _bible())
                                 .replace("[INSERT HEADERS HERE]", _headers())
                                 .replace("[INSERT EXAMPLES HERE]", _examples() or "(none yet)"))
    return _CACHE["draw_system"]


def _call(engine, system: str, user: str, kind: str, images: list = None, effort: str = "", model: str = "",
          max_tokens: int = 24000) -> str:
    """One Claude call with a STATIC system prompt and a small user message. Through the Claude Code login the
    system prompt is cached for an hour, so every later call with the same system prompt reads it at a tenth of the
    input price; the reply's cost is added to the job's tally (folio/cost.json). Other providers get system + user
    as one prompt."""
    model = model or MODEL
    if str(getattr(engine, "CLAUDE_PROVIDER", "")).lower() != "claudecode" or not hasattr(engine, "_claude_exe"):
        if images:
            return engine.claude_vision(system + "\n\n" + user, list(images), model=model, max_tokens=max_tokens)
        return engine.claude(system + "\n\n" + user, model, max_tokens=max_tokens)
    # pictures go INSIDE the message (stream-json input): one turn, no Read tool — so a rework shares the drawings'
    # cached system prompt instead of starting its own cache, and costs about a third less
    cmd = [engine._claude_exe(), "-p", "--model", model, "--strict-mcp-config", "--tools", "",
           "--no-session-persistence", "--disable-slash-commands", "--system-prompt", system]
    if effort:
        cmd += ["--effort", effort]
    if images:
        import base64
        content = []
        for x in list(images)[:6]:
            data = Path(x).read_bytes()
            mt = "image/png" if data[:4] == b"\x89PNG" else "image/jpeg"
            content.append({"type": "image", "source": {"type": "base64", "media_type": mt,
                                                        "data": base64.b64encode(data).decode()}})
        content.append({"type": "text", "text": user})
        prompt = json.dumps({"type": "user", "message": {"role": "user", "content": content}}) + "\n"
        cmd += ["--input-format", "stream-json", "--output-format", "stream-json", "--verbose"]
    else:
        prompt = user
        cmd += ["--output-format", "json"]
    last = ""
    for attempt in range(3):
        try:
            r = subprocess.run(cmd, input=prompt, text=True, capture_output=True, env=engine._cc_env(),
                               timeout=int(getattr(engine, "CC_TIMEOUT", 900)), cwd=str(engine.CC_CWD),
                               encoding="utf-8", errors="replace")
            if images:          # stream-json: the last "result" line carries the answer and the usage
                rows = [json.loads(ln) for ln in (r.stdout or "").splitlines() if ln.strip().startswith("{")]
                d = next((x for x in reversed(rows) if x.get("type") == "result"), {})
            else:
                d = json.loads(r.stdout or "{}")
            out = str(d.get("result") or "").strip()
            if r.returncode == 0 and out and not d.get("is_error"):
                u = d.get("usage") or {}
                with _SPEND_LOCK:
                    _SPEND["usd"] += float(d.get("total_cost_usd") or 0)
                    _SPEND["calls"] += 1
                    _SPEND["cache_read"] += int(u.get("cache_read_input_tokens") or 0)
                    _SPEND["cache_write"] += int(u.get("cache_creation_input_tokens") or 0)
                    _SPEND["out"] += int(u.get("output_tokens") or 0)
                    k = _SPEND["by"].setdefault(kind, {"calls": 0, "usd": 0.0})
                    k["calls"] += 1
                    k["usd"] += float(d.get("total_cost_usd") or 0)
                return out
            last = (out or r.stderr or "")[:200]
            if any(w in last.lower() for w in ("authentication", "oauth", "usage limit")):
                break
        except (subprocess.TimeoutExpired, OSError, ValueError) as e:
            last = str(e)[:200]
        time.sleep(4 * (attempt + 1))
    raise RuntimeError(f"claude ({kind}): {last or 'no reply'}")


def _ask(engine, prompt: str, max_tokens: int, model: str = "") -> str:
    return engine.claude(prompt, model or MODEL, max_tokens=max_tokens)


def _look(engine, prompt: str, images: list, model: str = "") -> str:
    """Claude looking at pictures. Through the Claude Code login the pictures are opened with the Read tool and the
    chosen model answers (the engine's own vision call always uses its default model); otherwise the engine's."""
    model = model or MODEL
    if str(getattr(engine, "CLAUDE_PROVIDER", "")).lower() == "claudecode" and hasattr(engine, "_claude_exe"):
        paths = [str(Path(x).resolve()) for x in images][:10]
        full = "First read these image files so you can actually see them:\n" + "\n".join(f"- {x}" for x in paths) + "\n\n" + prompt
        cmd = [engine._claude_exe(), "-p", "--model", model, "--tools", "Read", "--allowedTools", "Read",
               "--permission-mode", "dontAsk", "--strict-mcp-config", "--output-format", "text",
               "--no-session-persistence", "--disable-slash-commands", "--system-prompt", engine.CC_SYSTEM]
        for d in sorted({str(Path(x).parent) for x in paths}):
            cmd += ["--add-dir", d]
        for attempt in range(2):
            try:
                r = subprocess.run(cmd, input=full, text=True, capture_output=True, env=engine._cc_env(),
                                   timeout=int(getattr(engine, "CC_TIMEOUT", 900)), cwd=str(engine.CC_CWD),
                                   encoding="utf-8", errors="replace")
                if r.returncode == 0 and (r.stdout or "").strip():
                    return r.stdout.strip()
            except (subprocess.TimeoutExpired, OSError):
                pass
            time.sleep(3)
    return engine.claude_vision(prompt, list(images), model=model, max_tokens=24000)


# ── 1. the storyboard (beside the voiceover) ─────────────────────────────────────────────
STORY_PART_WORDS = 320          # about two minutes of narration per storyboard call (the reply stays well under its limit)


def _story_system(engine) -> str:
    if "story_system" not in _CACHE:
        base = (STORYBOARD_PROMPT.replace("[INSERT BIBLE HERE]", _bible()).replace("[INSERT HEADERS HERE]", _headers()))
        _CACHE["story_system"] = base + (engine._extra_block() if hasattr(engine, "_extra_block") else "")
    return _CACHE["story_system"]


def storyboard(engine, script: str, job: Path, style: str, force: bool = False) -> dict:
    """The cast and the shot list, written in parts of about two minutes (a long film would not fit one reply);
    each part gets the cast so far, so people stay the same, and continues the shot numbers."""
    out = job / "folio" / "storyboard.json"
    if out.exists() and not force:
        return json.loads(out.read_text(encoding="utf-8"))
    out.parent.mkdir(parents=True, exist_ok=True)
    title = ""
    try:
        title = (job / "title.txt").read_text(encoding="utf-8").splitlines()[0].strip()
    except (OSError, IndexError):
        pass
    t, lines = LEAD_IN, []
    for sen in _sentences(script):
        lines.append((t, sen))
        t += len(sen.split()) * 60.0 / WPM + 0.45
    parts, cur, n = [], [], 0
    for ln in lines:
        cur.append(ln)
        n += len(ln[1].split())
        if n >= STORY_PART_WORDS:
            parts.append(cur)
            cur, n = [], 0
    if cur:
        if parts and sum(len(x[1].split()) for x in cur) < STORY_PART_WORDS * 0.3:
            parts[-1] += cur                            # a short tail joins the part before it
        else:
            parts.append(cur)
    _log(engine, f"FOLIO: storyboard ({len(lines)} sentences in {len(parts)} part(s), {MODEL})...")
    cast, shots = {}, []
    for k, part in enumerate(parts):
        where = ("This is the whole film." if len(parts) == 1 else
                 f"This is part {k + 1} of {len(parts)} of the film" + (" — its opening." if k == 0 else
                 " — its ending." if k == len(parts) - 1 else " — neither its opening nor its ending."))
        user = (STORYBOARD_USER.replace("[INSERT TITLE HERE]", title or "(untitled)")
                .replace("[INSERT PART HERE]", where)
                .replace("[INSERT CAST HERE]", json.dumps(cast, indent=1, ensure_ascii=False) if cast else "(nobody yet)")
                .replace("[INSERT LINES HERE]", "\n".join(f"{a:6.1f}  {sen}" for a, sen in part))
                .replace("[INSERT FIRST ID HERE]", f"s{len(shots) + 1:02d}"))
        board = None
        for attempt in range(3):
            try:
                board = _json_from(_call(engine, _story_system(engine), user, "storyboard"))
            except Exception as e:                              # noqa: BLE001
                _log(engine, f"  storyboard part {k + 1}: {str(e)[:100]}")
                board = None
            if isinstance(board, dict) and board.get("shots"):
                break
            _log(engine, f"  storyboard part {k + 1} came back unreadable, asking again")
        if not isinstance(board, dict) or not board.get("shots"):
            raise RuntimeError(f"FOLIO: no storyboard for part {k + 1}")
        for cid, d in (board.get("cast") or {}).items():
            cast.setdefault(cid, d)
        for sh in board["shots"]:
            sh["id"] = f"s{len(shots) + 1:02d}"
            shots.append(sh)
    if shots:
        shots[-1]["out"] = {"kind": "cut"}
    board = {"cast": cast, "shots": shots}
    out.write_text(json.dumps(board, indent=1, ensure_ascii=False), encoding="utf-8")
    _log(engine, f"  {len(shots)} shots, cast: {', '.join(cast) or 'none'}")
    return board


def prepare(engine, script: str, job: Path, style: str, force: bool) -> None:
    """Beside the voiceover: the cast and the shot list (they need only the words, not their times)."""
    storyboard(engine, script, job, style, force)


# ── 2. timing: every shot on its words ────────────────────────────────────────────────────
def _heard_words(engine, job: Path, srt: Path) -> list:
    """[(word, start, end)] on the voice's clock: the subtitle words, timed by whisper where it could hear them."""
    cues = engine._parse_srt_full(srt.read_text(encoding="utf-8"))
    clock = {}
    try:
        clock = engine._word_clock(job, srt) or {}
    except Exception as e:                                          # noqa: BLE001 - letters are a fine fallback
        _log(engine, f"  word clock unavailable ({str(e)[:80]}), timing words by their letters")
    words = []
    for k, (st, en, txt) in enumerate(cues):
        ws = txt.split()
        times = clock.get(k)
        if not times or len(times) != len(ws):
            tot = sum(len(w) + 1 for w in ws) or 1
            acc, times = 0.0, []
            for w in ws:
                a = st + (en - st) * acc / tot
                acc += len(w) + 1
                times.append((a, st + (en - st) * acc / tot))
        words += [(w, float(a), float(b)) for w, (a, b) in zip(ws, times)]
    return words


# ── words as the voice says them: "40,000" = "forty thousand", "50th" = "fiftieth", "kilometres" = "kilometers" ──
_ONES = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen " \
        "seventeen eighteen nineteen".split()
_TENS_W = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split()
_ORDW = {"first": "one", "second": "two", "third": "three", "fifth": "five", "eighth": "eight", "ninth": "nine",
         "twelfth": "twelve", "hundredth": "hundred", "thousandth": "thousand", "millionth": "million"}


def _say(n: int) -> list:
    if n < 20:
        return [_ONES[n]]
    if n < 100:
        return [_TENS_W[n // 10]] + ([_ONES[n % 10]] if n % 10 else [])
    if n < 1000:
        return [_ONES[n // 100], "hundred"] + (_say(n % 100) if n % 100 else [])
    for div, name in ((10 ** 9, "billion"), (10 ** 6, "million"), (1000, "thousand")):
        if n >= div:
            return _say(n // div) + [name] + (_say(n % div) if n % div else [])
    return [str(n)]


def _spoken_tokens(word: str) -> list:
    """One written word as the tokens it is spoken as, spelling variants folded (both sides of an alignment go
    through this, so "Forty thousand kilometres" meets "40,000 kilometers")."""
    w = _norm_keep(word)
    m = re.fullmatch(r"(\d{1,3}(?:,\d{3})+|\d+)(st|nd|rd|th|s)?", w)
    if m:
        n = int(m.group(1).replace(",", ""))
        return _say(n) if n < 10 ** 12 else [m.group(1)]
    out = []
    for t in re.findall(r"[a-z0-9]+", w):
        if t == "and":
            continue
        if t in _ORDW:
            t = _ORDW[t]
        elif t.endswith("ieth") and t[:-4] + "y" in _TENS_W:           # fiftieth → fifty
            t = t[:-4] + "y"
        elif t.endswith("th") and t[:-2] in _ONES:                        # seventh, nineteenth → seven, nineteen
            t = t[:-2]
        t = re.sub(r"tre(s?)$", r"ter\1", t) if len(t) > 4 else t          # centimetre → centimeter
        t = re.sub(r"our(s?|ed|ing)$", r"or\1", t) if len(t) > 5 else t    # harbour → harbor
        t = re.sub(r"is(e|ed|es|ing)$", r"iz\1", t) if len(t) > 6 else t   # realise → realize
        out.append(t)
    return out


def _norm_keep(w: str) -> str:
    import unicodedata
    w = unicodedata.normalize("NFKD", str(w).lower())
    return "".join(c for c in w if not unicodedata.combining(c)).strip(".,;:!?\"'“”‘’()[]—–-")


def _shot_starts(board: dict, script: str, heard: list) -> list:
    """The word index (into `heard`) where each shot starts: the shot's "from" words found in the script in order,
    the script aligned to what the voice said — both as spoken tokens (numbers as words, spelling folded)."""
    import difflib
    stoks, htoks, hidx = [], [], []
    for w in script.split():
        stoks += _spoken_tokens(w)
    for k, (w, _, _) in enumerate(heard):
        for t in _spoken_tokens(w):
            htoks.append(t)
            hidx.append(k)
    s2h = {}
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, stoks, htoks, autojunk=False).get_opcodes():
        if tag == "equal" or (tag == "replace" and i2 - i1 == j2 - j1):
            for i, j in zip(range(i1, i2), range(j1, j2)):
                s2h[i] = hidx[j]
    starts, pos = [], 0
    for sh in board["shots"]:
        want = []
        for w in str(sh.get("from") or "").split():
            want += _spoken_tokens(w)
        want = want[:6]
        found = None
        for n in (len(want), 3, 2):
            if not want[:n]:
                continue
            for i in range(pos, len(stoks)):
                if stoks[i:i + n] == want[:n]:
                    found = i
                    break
            if found is not None:
                break
        if found is None:
            starts.append(None)
            continue
        pos = found + 1
        k = found
        while k < len(stoks) and s2h.get(k) is None:          # the nearest heard word at or after it
            k += 1
        starts.append(s2h.get(k))
    return starts


def _shot_starts_old(board: dict, script: str, heard: list) -> list:
    import difflib
    stoks = [_norm(w) for w in script.split()]
    stoks = [w for w in stoks if w]
    htoks = [_norm(w) for w, _, _ in heard]
    s2h = {}
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, stoks, htoks, autojunk=False).get_opcodes():
        if tag == "equal" or (tag == "replace" and i2 - i1 == j2 - j1):
            for i, j in zip(range(i1, i2), range(j1, j2)):
                s2h[i] = j
    starts, pos = [], 0
    for sh in board["shots"]:
        want = [w for w in (_norm(x) for x in str(sh.get("from") or "").split()) if w][:6]
        found = None
        if want:
            for i in range(pos, len(stoks)):
                if stoks[i:i + len(want)] == want:
                    found = i
                    break
            if found is None and len(want) > 2:          # a word the model changed: try its first three
                for i in range(pos, len(stoks)):
                    if stoks[i:i + 3] == want[:3]:
                        found = i
                        break
        if found is None:
            starts.append(None)
            continue
        pos = found + 1
        j = s2h.get(found)
        k = found
        while j is None and k < len(stoks) - 1:           # the nearest heard word after it
            k += 1
            j = s2h.get(k)
        starts.append(j)
    return starts


def _shot_starts_spoken(engine, board: dict, srt: Path, heard: list) -> list:
    """The heard-word index where each shot starts, found the way Frontier's director finds a line: the shot's first
    words matched in the spoken stream in order, spelled-out numbers against the digits the subtitles write
    ("forty thousand" / "40,000"), a skipped or an extra word allowed. None where a shot's words are not found."""
    cues = engine._parse_srt_full(srt.read_text(encoding="utf-8"))
    stream = engine._spoken_stream(cues)
    out, est = [], 0.0
    for k, sh in enumerate(board["shots"]):
        t = engine._find_line(stream, str(sh.get("from") or ""), est, est - 0.05, 1e9)
        if t is None or (out and any(x is not None for x in out) and t < est - 0.05):
            out.append(None)
            continue
        est = float(t)
        j = next((i for i, (_, a, _) in enumerate(heard) if a >= est - 0.08), None)
        out.append(j)
    return out


def timeline(engine, board: dict, script: str, heard: list, fps: int = FPS, srt: Path = None) -> list:
    """[{shot, a, b (timeline seconds of its cut in and out), in, out, words}] — cuts sit in the pauses just before
    each shot's first word, frame-aligned; the film starts LEAD_IN before the first word and ends TAIL after the last."""
    starts = _shot_starts(board, script, heard)
    if None in starts and srt is not None and hasattr(engine, "_find_line"):
        try:                                   # a shot whose words the alignment missed: the director's line finder
            alt = _shot_starts_spoken(engine, board, srt, heard)
            starts = [a if a is not None else b for a, b in zip(starts, alt)]
        except Exception as e:                                      # noqa: BLE001
            _log(engine, f"  shot timing by the spoken stream failed ({str(e)[:80]})")
    shots = [dict(sh) for sh in board["shots"]]
    keep = [(sh, j) for sh, j in zip(shots, starts) if j is not None]
    if not keep:
        raise RuntimeError("FOLIO: none of the storyboard's shots could be found in the narration")
    keep[0] = (keep[0][0], 0)
    # a shot whose words were not found folds into the one before it
    merged = []
    for sh, j in keep:
        if merged and j <= merged[-1][1]:
            continue
        merged.append((sh, j))
    end_voice = heard[-1][2] + LEAD_IN
    fr = lambda x: round(x * fps) / fps
    rows = []
    for i, (sh, j) in enumerate(merged):
        if i == 0:
            a = 0.0
        else:
            w0 = heard[j][1] + LEAD_IN
            prev_end = heard[j - 1][2] + LEAD_IN if j > 0 else 0.0
            gap = w0 - prev_end
            a = max(prev_end + 0.08, w0 - (0.3 if gap > 0.55 else 0.14))
        rows.append({"shot": sh, "a": fr(a), "j": j})
    for i, r in enumerate(rows):
        r["b"] = rows[i + 1]["a"] if i + 1 < len(rows) else fr(end_voice + TAIL)
        j1 = rows[i + 1]["j"] if i + 1 < len(rows) else len(heard)
        r["words"] = [(w, a + LEAD_IN, b + LEAD_IN) for w, a, b in heard[r["j"]:j1]]
    # transitions: the out of one shot is the in of the next; a transition longer than either side is cut short
    import copy
    for i, r in enumerate(rows):
        o = copy.deepcopy(r["shot"].get("out") or {"kind": "cut"})
        if i == len(rows) - 1:
            o = {"kind": "cut"}
        r["out"] = o
        r["in"] = copy.deepcopy(rows[i - 1]["out"]) if i > 0 else {"kind": "cut"}
    return rows


# ── 3. the shot programs ───────────────────────────────────────────────────────────────────
_TR_D = {"cut": 0.0, "dissolve": 0.6, "defocus": 0.45, "bloom": 0.4, "whiteout": 0.3, "whip": 0.12, "tilt": 0.12,
         "push": 0.16, "cover": 0.0, "reveal": 0.0, "wipe": 0.0}


def _d(tr: dict) -> float:
    k = str((tr or {}).get("kind") or "cut")
    return float(tr.get("d", _TR_D.get(k, 0.0))) if isinstance(tr, dict) else 0.0


def _shot_scene(row: dict, board: dict, fps: int = FPS) -> dict:
    """The SCENE a shot's page receives: its rendered span (cut ± half of each dissolve), words on its own clock."""
    d_in, d_out = _d(row["in"]), _d(row["out"])
    t0 = row["a"] - d_in / 2
    t1 = row["b"] + d_out / 2
    t0 = round(t0 * fps) / fps
    t1 = round(t1 * fps) / fps
    words = [{"w": w, "t0": round(a - t0, 3), "t1": round(b - t0, 3)} for w, a, b in row["words"]]
    sh = row["shot"]
    return {"id": sh.get("id") or "shot", "dur": round(t1 - t0, 4), "t0": t0, "words": words,
            "in": dict(row["in"], d=d_in), "out": dict(row["out"], d=d_out), "cast": board.get("cast") or {},
            "shot": {k: sh.get(k) for k in ("picture", "camera", "text", "sound") if sh.get(k)}}


def _describe(sh: dict) -> str:
    if not sh:
        return "(none — this is the first or the last shot)"
    return json.dumps({k: sh.get(k) for k in ("picture", "camera", "text", "out") if sh.get(k)}, ensure_ascii=False)


def _notes(fdir: Path) -> dict:
    """{shot id: note} — a person's notes on shots (folio/notes.json), given to the illustrator when it redraws them."""
    f = Path(fdir) / "notes.json"
    try:
        return json.loads(f.read_text(encoding="utf-8")) if f.exists() else {}
    except (ValueError, OSError):
        return {}


def redo(job: Path, shot: str, note: str = "") -> None:
    """Redraw one shot on the next assemble, with an optional note: its program, review and render are cleared (the
    others stay cached), and the final video goes, so the film is joined again."""
    fdir = Path(job) / "folio"
    if note:
        notes = _notes(fdir)
        notes[shot] = note
        (fdir / "notes.json").write_text(json.dumps(notes, indent=1, ensure_ascii=False), encoding="utf-8")
    for f in [fdir / "shots" / f"{shot}.js", fdir / "shots" / f"{shot}.reviewed", fdir / "mp4" / f"{shot}.mp4",
              Path(job) / "video.mp4", Path(job) / "_folio_sound.wav"]:
        f.unlink(missing_ok=True)
    for f in (fdir / "under").glob("*.png"):      # a neighbour's sliding sheet may show this shot
        f.unlink(missing_ok=True)


def write_program(engine, row: dict, prev: dict, nxt: dict, scene: dict, board: dict, out: Path, force: bool = False) -> str:
    if out.exists() and not force:
        return out.read_text(encoding="utf-8")
    words = "\n".join(f"{w['t0']:6.2f}  {w['w']}" for w in scene["words"]) or "(no words — music only)"
    shot = dict(row["shot"])
    shot["in"], shot["out"] = scene["in"], scene["out"]
    prompt = (DRAW_USER.replace("[INSERT CAST HERE]", json.dumps(board.get("cast") or {}, indent=1, ensure_ascii=False))
              .replace("[INSERT SHOT HERE]", json.dumps(shot, indent=1, ensure_ascii=False))
              .replace("[INSERT DUR HERE]", f"{scene['dur']:.2f}")
              .replace("[INSERT WORDS HERE]", words)
              .replace("[INSERT PREV HERE]", _describe(prev))
              .replace("[INSERT NEXT HERE]", _describe(nxt)))
    note = _notes(out.parent.parent).get(scene["id"])
    if note:
        prompt += ("\n\nTHE DIRECTOR'S NOTE FOR THIS SHOT — it overrides the storyboard where they differ, follow it "
                   "exactly:\n" + note)
    code = _code_from(_call(engine, _draw_system(), prompt, "draw"))
    if "FOLIO.scene" not in code:
        raise RuntimeError(f"{scene['id']}: the illustrator returned no program")
    out.write_text(code, encoding="utf-8")
    return code


_TR_MOVE = {"whiteout": 0.9, "whip": 0.32, "tilt": 0.32, "push": 0.5, "cover": 0.4, "reveal": 0.4, "wipe": 0.36,
            "defocus": 0.55, "bloom": 0.45}


def _check_render(program: str, scene: dict, qdir: Path, name: str) -> tuple:
    """(error text or "", [three stills]) — the program run at the start, middle and end of the shot, the start and
    end taken just clear of its transitions (a whiteout's white is the runtime's, not the drawing's)."""
    d = scene["dur"]
    ti, to = scene.get("in") or {}, scene.get("out") or {}
    a = (ti.get("d") or 0) / 2 + _TR_MOVE.get(ti.get("kind"), 0) + 0.1
    b = d - (to.get("d") or 0) / 2 - _TR_MOVE.get(to.get("kind"), 0) - 0.1
    if b - a < 0.4:
        a, b = d * 0.25, d * 0.75
    try:
        ps = stills(program, scene, [max(0.2, min(a, d * 0.45)), d * 0.5, min(d - 0.2, max(b, d * 0.55))], qdir, name, 0.5)
        return "", ps
    except Exception as e:                                          # noqa: BLE001 - the error goes back to the model
        return str(e)[:1500], []


def _sheet(paths: list, out: Path) -> Path:
    from PIL import Image
    ims = [Image.open(p).convert("RGB") for p in paths]
    w, h = ims[0].size
    sheet = Image.new("RGB", (w * len(ims) + 8 * (len(ims) - 1), h), (20, 20, 20))
    for i, im in enumerate(ims):
        sheet.paste(im, (i * (w + 8), 0))
    sheet.save(out, quality=88)
    return out


def make_program(engine, row, prev, nxt, scene, board, sdir: Path, force: bool, review: bool) -> str:
    """Write → run → fix errors (twice) → an art director looks at three frames → up to two reworks, the illustrator
    seeing its own frames. A program that was already reviewed is taken as it is."""
    pf = sdir / f"{scene['id']}.js"
    reviewed = sdir / f"{scene['id']}.reviewed"
    if pf.exists() and reviewed.exists() and not force:
        return pf.read_text(encoding="utf-8")
    code = write_program(engine, row, prev, nxt, scene, board, pf, force)
    qdir = sdir / "qa"
    for attempt in range(3):
        err, ps = _check_render(code, scene, qdir, scene["id"])
        if not err:
            break
        _log(engine, f"  {scene['id']}: error, fixing ({err.splitlines()[0][:100]})")
        code = _code_from(_call(engine, _draw_system(), FIX_PROMPT.replace("[INSERT ERROR HERE]", err)
                                .replace("[INSERT CODE HERE]", code), "fix"))
        pf.write_text(code, encoding="utf-8")
    else:
        raise RuntimeError(f"{scene['id']}: the program still fails after two fixes")
    notes = []
    for rnd in range(2 if review else 0):
        if not ps:
            break
        sheet = _sheet(ps, qdir / f"{scene['id']}_sheet{rnd or ''}.jpg")
        try:
            verdict = _json_from(_call(engine, REVIEW_SYSTEM, REVIEW_PROMPT.replace("[INSERT SHOT HERE]", _describe(row["shot"])),
                                       "review", images=[str(sheet)], effort="low")) or {}
        except Exception as e:                                      # noqa: BLE001 - a review is a bonus
            verdict = {}
            _log(engine, f"  {scene['id']}: no review ({str(e)[:80]})")
        probs = [str(p) for p in (verdict.get("problems") or [])][:5]
        notes.append(verdict)
        if verdict.get("ok") is not False or not probs:
            break
        _log(engine, f"  {scene['id']}: reworking — {probs[0][:100]}")
        try:
            new = _code_from(_call(engine, _draw_system(), REWORK_PROMPT
                                   .replace("[INSERT PROBLEMS HERE]", "\n".join("- " + p for p in probs))
                                   .replace("[INSERT SHOT HERE]", _describe(row["shot"]))
                                   .replace("[INSERT CODE HERE]", code), "rework", images=[str(sheet)]))
        except Exception as e:                                      # noqa: BLE001 - keep the drawing we have
            _log(engine, f"  {scene['id']}: no rework ({str(e)[:80]})")
            break
        if "FOLIO.scene" not in new:
            break
        err, ps2 = _check_render(new, scene, qdir, f"{scene['id']}_r{rnd + 1}")
        if err:
            _log(engine, f"  {scene['id']}: the rework failed to run, keeping the earlier version")
            break
        code, ps = new, ps2
        pf.write_text(code, encoding="utf-8")
    if review:
        reviewed.write_text(json.dumps(notes, ensure_ascii=False), encoding="utf-8")
    return code


# ── 4. render every shot, then join them ─────────────────────────────────────────────────
def _under_images(rows: list, scenes: list, programs: list, sdir: Path) -> None:
    """A sheet that slides over the previous shot needs that shot's last frame (cover, wipe); one that slides away
    needs the next shot's first frame (reveal). Stills of the neighbours, made before the shots render."""
    for i, sc in enumerate(scenes):
        need = None
        if sc["in"].get("kind") in ("cover", "wipe") and i > 0:
            need = (i - 1, max(0.0, scenes[i - 1]["dur"] - 1.0 / FPS))
        if sc["out"].get("kind") == "reveal" and i + 1 < len(scenes):
            need = (i + 1, 0.0)
        if need is None:
            continue
        k, t = need
        png = sdir / "under" / f"{sc['id']}_under.png"
        if not png.exists():
            neighbour = dict(scenes[k], **{"in": {"kind": "cut", "d": 0}, "out": {"kind": "cut", "d": 0}})
            got = stills(programs[k], neighbour, [t], png.parent, f"{sc['id']}_n")[0]
            Path(got).replace(png)
        sc["under_img"] = png.as_uri()


def render_all(engine, scenes: list, programs: list, sdir: Path, force: bool) -> list:
    from playwright.sync_api import sync_playwright
    outs = [sdir / "mp4" / f"{sc['id']}.mp4" for sc in scenes]
    outs[0].parent.mkdir(parents=True, exist_ok=True)
    todo = [i for i, o in enumerate(outs) if force or not (o.exists() and o.stat().st_size > 10_000)]
    if not todo:
        return outs
    workers = max(1, min(WORKERS, len(todo)))
    _log(engine, f"FOLIO: rendering {len(todo)} shot(s) in Chromium ({workers} worker{'s' if workers > 1 else ''})...")
    t0 = time.time()

    def run(chunk):
        with sync_playwright() as pw:
            browser = _launch(pw)
            try:
                for i in chunk:
                    render_shot(programs[i], scenes[i], outs[i], FPS, browser, sdir / "_pages")
                    _log(engine, f"  {scenes[i]['id']} ✓ ({scenes[i]['dur']:.1f}s)")
            finally:
                browser.close()

    with render_lock(f"folio {sdir.parent.name}"):
        with ThreadPoolExecutor(max_workers=workers) as ex:
            list(ex.map(run, [todo[k::workers] for k in range(workers)]))
    _log(engine, f"  rendered in {time.time() - t0:.0f}s")
    return outs


def compose(scenes: list, mp4s: list, out: Path, total: float, fps: int = FPS) -> Path:
    """One picture: every shot on the timeline, dissolving into the next over its transition's d."""
    import numpy as np
    n_out = int(round(total * fps))
    tmp = out.with_suffix(".part.mp4")
    enc = subprocess.Popen(["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}",
                            "-r", str(fps), "-i", "-", "-c:v", "libx264", "-preset", "medium", "-crf", "14", "-tune", "animation",
                            "-pix_fmt", "yuv420p", "-color_range", "tv", "-colorspace", "bt709", "-color_primaries", "bt709",
                            "-color_trc", "bt709", str(tmp)], stdin=subprocess.PIPE)
    readers, frames = {}, {}

    def open_reader(i):
        p = subprocess.Popen(["ffmpeg", "-v", "error", "-i", str(mp4s[i]), "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                             stdout=subprocess.PIPE)
        readers[i] = [p, int(round(scenes[i]["t0"] * fps)), 0]   # process, first timeline frame, frames read

    def frame_of(i, k):
        """shot i's frame for timeline frame k (sequential reads; the last frame repeats if a shot ran short)."""
        if i not in readers:
            open_reader(i)
        p, first, got = readers[i]
        want = k - first
        while got <= want:
            buf = p.stdout.read(W * H * 3)
            if len(buf) < W * H * 3:
                break
            frames[i] = np.frombuffer(buf, np.uint8).reshape(H, W, 3)
            got += 1
        readers[i][2] = got
        return frames.get(i)

    try:
        for k in range(n_out):
            T = k / fps
            live = [i for i, sc in enumerate(scenes) if sc["t0"] - 1e-6 <= T < sc["t0"] + sc["dur"] - 1e-6]
            if not live:
                live = [len(scenes) - 1] if T >= scenes[-1]["t0"] else [0]
            if len(live) == 1:
                f = frame_of(live[0], k)
            else:
                i, j = live[0], live[-1]
                a, b = frame_of(i, k), frame_of(j, k)
                d = scenes[j]["in"].get("d") or 0.0
                cut = scenes[j]["t0"] + d / 2
                w = 0.5 if d <= 0 else float(np.clip((T - (cut - d / 2)) / d, 0, 1))
                w = w * w * (3 - 2 * w)
                f = a if b is None else b if a is None else (a.astype(np.float32) * (1 - w) + b.astype(np.float32) * w + 0.5).astype(np.uint8)
            if f is None:
                f = np.zeros((H, W, 3), np.uint8)
            enc.stdin.write(np.ascontiguousarray(f).tobytes())
            for i in [i for i in list(readers) if scenes[i]["t0"] + scenes[i]["dur"] < T - 0.5]:
                readers.pop(i)[0].kill()
                frames.pop(i, None)
    finally:
        for p, _, _ in readers.values():
            p.kill()
        enc.stdin.close()
        ok = enc.wait() == 0
    if not ok:
        raise RuntimeError("FOLIO: the joined picture failed to encode")
    tmp.replace(out)
    return out


# ── 5. assemble ────────────────────────────────────────────────────────────────────────────
def assemble(engine, job: Path, mp3: Path, srt: Path, style: str, force: bool, burn_subs: bool) -> Path:
    final = job / "video.mp4"
    if final.exists() and not force:
        _log(engine, f"cached: {final.name}")
        return final
    cfg = _cfg(engine, style)
    sdir = job / "folio"
    sdir.mkdir(parents=True, exist_ok=True)
    script = (job / "script.txt").read_text(encoding="utf-8")
    board = storyboard(engine, script, job, style, False)
    heard = _heard_words(engine, job, srt)
    if not heard:
        raise RuntimeError("FOLIO: the narration has no timed words")
    rows = timeline(engine, board, script, heard, srt=srt)
    scenes = [_shot_scene(r, board) for r in rows]
    (sdir / "timeline.json").write_text(json.dumps([{"id": s["id"], "t0": s["t0"], "dur": s["dur"], "in": s["in"],
                                                     "out": s["out"], "first": (s["words"][0]["w"] if s["words"] else "")}
                                                    for s in scenes], indent=1, ensure_ascii=False), encoding="utf-8")
    # the shot programs, written in parallel (each one is a separate drawing)
    review = cfg.get("review", True) is not False
    _log(engine, f"FOLIO: drawing {len(scenes)} shots ({MODEL}{', with an art director' if review else ''})...")
    progs = [None] * len(scenes)

    def draw(i):
        progs[i] = make_program(engine, rows[i], rows[i - 1]["shot"] if i else None,
                                rows[i + 1]["shot"] if i + 1 < len(rows) else None, scenes[i], board, sdir / "shots",
                                force, review)
        _log(engine, f"  {scenes[i]['id']} drawn")

    (sdir / "shots").mkdir(parents=True, exist_ok=True)
    todo = [i for i in range(len(scenes))
            if force or not ((sdir / "shots" / f"{scenes[i]['id']}.js").exists() and (sdir / "shots" / f"{scenes[i]['id']}.reviewed").exists())]
    done = [i for i in range(len(scenes)) if i not in todo]
    for i in done:
        draw(i)
    if todo:
        # the first drawing writes the illustrator's instructions into the cache; the rest then read them for a tenth
        draw(todo[0])
        with ThreadPoolExecutor(max_workers=int(cfg.get("writers", 3))) as ex:
            list(ex.map(draw, todo[1:]))
    if _SPEND["calls"]:
        spent = dict(_SPEND, usd=round(_SPEND["usd"], 3), by={k: dict(v, usd=round(v["usd"], 3)) for k, v in _SPEND["by"].items()})
        prev_f = sdir / "cost.json"
        try:
            hist = json.loads(prev_f.read_text(encoding="utf-8")) if prev_f.exists() else []
        except (ValueError, OSError):
            hist = []
        hist = (hist if isinstance(hist, list) else [hist]) + [dict(spent, at=time.strftime("%Y-%m-%d %H:%M"))]
        prev_f.write_text(json.dumps(hist, indent=1), encoding="utf-8")
        _log(engine, f"FOLIO: Claude this run ≈ ${spent['usd']:.2f} at API prices ({spent['calls']} calls: "
                     + ", ".join(f"{k} {v['calls']}× ${v['usd']:.2f}" for k, v in spent["by"].items()) + ")")
    _under_images(rows, scenes, progs, sdir)
    mp4s = render_all(engine, scenes, progs, sdir, force)
    total = scenes[-1]["t0"] + scenes[-1]["dur"]
    _log(engine, "FOLIO: joining the shots...")
    compose(scenes, mp4s, job / "_visual.mp4", total)
    # the sound: narration placed LEAD_IN in, a score and the effects under it, mastered
    import folio_sound
    sound = folio_sound.soundtrack(engine, job, mp3, scenes, rows, total, style, lead=LEAD_IN)
    # the subtitles on the film's clock (chapters and the description read them)
    shifted = job / "subs_folio.srt"
    cues = engine._parse_srt_full(srt.read_text(encoding="utf-8"))
    ts = lambda x: f"{int(x // 3600):02d}:{int(x % 3600 // 60):02d}:{int(x % 60):02d},{int(round((x % 1) * 1000)) % 1000:03d}"
    shifted.write_text("\n".join(f"{i + 1}\n{ts(a + LEAD_IN)} --> {ts(b + LEAD_IN)}\n{t}\n" for i, (a, b, t) in enumerate(cues)),
                       encoding="utf-8")
    engine.USE_SOUND_BED = False                   # the score is ours; no second bed under it
    engine._final_mux(job, sound, shifted, bool(burn_subs and cfg.get("captions")), add_qr=False, vignette=False)
    (job / "_visual.mp4").unlink(missing_ok=True)
    return final


def contact_sheet(video: Path, out: Path, every: float = 1.0, cols: int = 6, width: int = 480) -> Path:
    """A timestamped grid of a finished video's frames, one every `every` seconds — for checking a film by eye."""
    from PIL import Image, ImageDraw
    video, out = Path(video), Path(out)
    tmp = out.parent / (out.stem + "_frames")
    tmp.mkdir(parents=True, exist_ok=True)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(video), "-vf", f"fps=1/{every},scale={width}:-2",
                    str(tmp / "f_%04d.jpg")], check=True)
    frames = sorted(tmp.glob("f_*.jpg"))
    if not frames:
        raise RuntimeError("no frames")
    w, h = Image.open(frames[0]).size
    rows = (len(frames) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * w, rows * h), (16, 16, 16))
    for i, f in enumerate(frames):
        im = Image.open(f)
        ImageDraw.Draw(im).text((6, 4), f"{i * every:05.1f}s", fill=(255, 230, 0))
        sheet.paste(im, ((i % cols) * w, (i // cols) * h))
    sheet.save(out, quality=86)
    shutil.rmtree(tmp, ignore_errors=True)
    return out


# ── developer CLI ───────────────────────────────────────────────────────────────────────
def _cli(argv: list) -> None:
    import argparse
    ap = argparse.ArgumentParser(prog="folio.py")
    ap.add_argument("cmd", choices=["still", "render", "check", "redo"])
    ap.add_argument("program", nargs="?")
    ap.add_argument("--dur", type=float, default=6.0)
    ap.add_argument("--t", default="")
    ap.add_argument("--words", default="")
    ap.add_argument("--scene", default="", help="a JSON file with extra scene fields (cast, in/out, palette)")
    ap.add_argument("--out", default="")
    ap.add_argument("--scale", type=float, default=1.0)
    ap.add_argument("--note", default="", help="redo: the note for the illustrator")
    a = ap.parse_args(argv)
    if a.cmd == "check":
        prog = (ASSETS / "demo.js").read_text(encoding="utf-8") if (ASSETS / "demo.js").exists() else \
            "FOLIO.scene({build(S){ const L=S.layer(); L.add('<rect width=\"1920\" height=\"1080\" fill=\"#E5DEC4\"/>'); }});"
        out = Path(a.out or HERE / "preview" / "folio")
        ps = stills(prog, {"id": "check", "dur": 4.0}, [0.5, 2.0, 3.5], out, "check", 0.5)
        print("ok:", *[str(p) for p in ps], sep="\n  ")
        return
    if a.cmd == "redo":                    # python folio.py redo <job folder> <shot id> --note "…"
        redo(Path(a.program), a.t, a.note)
        print(f"{a.t}: will be redrawn on the next assemble" + (" with the note" if a.note else ""))
        return
    prog = Path(a.program).read_text(encoding="utf-8")
    scene = {"id": Path(a.program).stem, "dur": a.dur}
    if a.scene:
        scene.update(json.loads(Path(a.scene).read_text(encoding="utf-8")))
    if a.words:
        scene["words"] = json.loads(Path(a.words).read_text(encoding="utf-8"))
    if a.cmd == "still":
        times = [float(x) for x in a.t.split(",")] if a.t else [0.0, scene["dur"] / 2, scene["dur"] - 0.05]
        out = Path(a.out or Path(a.program).with_suffix(""))
        for p in stills(prog, scene, times, out, Path(a.program).stem, a.scale):
            print(p)
    else:
        out = Path(a.out or Path(a.program).with_suffix(".mp4"))
        with render_lock(f"folio render {out.name}"):
            t0 = time.time()
            render_shot(prog, scene, out)
        print(f"{out}  ({time.time() - t0:.1f}s)")


if __name__ == "__main__":
    _cli(sys.argv[1:])
