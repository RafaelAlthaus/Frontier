#!/usr/bin/env python3
"""frames.py — how a footage shot sits in the frame, per look kit (the "smaller picture with something behind it").

cinema.py calls treat() for every n-th footage slot of a style whose look.cinema says
`"frame": "<kind>"` (with `frame_every` or `frame_all`). Each kind is one ffmpeg graph over a background
drawn once with PIL and cached in assets/kits/frames/:

    blurfill  LEGEND    the shot centred over a blurred, colour-matched copy of itself, a cream keyline;
                        every other one instead a yellow-bordered inset (a close-up) sliding in over the wide shot
    print     DOSSIER   a tilted print of the shot lying on an aviation chart under a spotlight, a soft shadow
    page      KINETIC   a white page: the shot as an embedded clip, the line being said typed under it
    stage     HUSTLE    a dark glossy stage: rounded corners, a white glow behind, a drop shadow
    crt       TAPE      the shot cropped to 9:16 inside a CRT panel with torn film edges, the sides a dark blurred
                        copy, scanlines over everything; every third one a triptych of three crops side by side
    monitor   DEEP      a dark teal monitor with a rounded screen, a stencil ARCHIVE label and a timecode
    news      FRONTLINE the shot full frame with a news band: a red tab, the line said crawling as a ticker
    paper     ATLAS     the shot pinned as a sheet of paper on a cartoon wall, taped at the corners, slightly turned

Everything here is an extra: a kind that fails leaves the plain shot in place.
"""

import math
import re
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
ASSETS = HERE / "assets" / "kits" / "frames"
FONTS = HERE / "assets" / "fonts"
W, H, FPS = 1920, 1080, 30
ENC = ["-c:v", "libx264", "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p", "-color_range", "tv", "-r", str(FPS),
       "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-an"]


def _log(mv, msg: str) -> None:
    (mv.log if mv is not None and hasattr(mv, "log") else print)(msg)


def _png(name: str, make) -> Path:
    p = ASSETS / name
    if not p.exists():
        ASSETS.mkdir(parents=True, exist_ok=True)
        make(p)
    return p


def _ground(gen: str, fallback: str, make) -> Path:
    """The ground behind a framed shot: assets/kits/frames/gen_<gen>.jpg when the image model drew one
    (kits.py / the style's setup), else the PIL drawing `fallback`."""
    g = ASSETS / f"gen_{gen}.jpg"
    return g if g.exists() else _png(fallback, make)


def _dark_box(img_path: Path, default: tuple) -> tuple:
    """The blank screen in a generated console picture: the near-black rectangle round the centre — the dark run
    along the centre row, then the rows above and below that stay dark across it (x0, y0, x1, y1); `default`
    when none is found. Cached beside the picture."""
    import json
    from PIL import Image
    import numpy as np
    cache = img_path.with_suffix(".box.json")
    if cache.exists():
        try:
            return tuple(json.loads(cache.read_text(encoding="utf-8")))
        except (OSError, ValueError):
            pass
    a = np.asarray(Image.open(img_path).convert("L").resize((W, H)), dtype=np.float32)
    cy, cx = H // 2, W // 2
    box = None
    if a[cy, cx] < 24:
        x0 = cx
        while x0 > 0 and a[cy, x0 - 1] < 24:
            x0 -= 1
        x1 = cx
        while x1 < W - 1 and a[cy, x1 + 1] < 24:
            x1 += 1
        inner = slice(x0 + 20, x1 - 20)
        y0 = cy
        while y0 > 0 and a[y0 - 1, inner].mean() < 14 and a[y0 - 1, inner].max() < 90:
            y0 -= 1
        y1 = cy
        while y1 < H - 1 and a[y1 + 1, inner].mean() < 14 and a[y1 + 1, inner].max() < 90:
            y1 += 1
        if (x1 - x0) > 300 and (y1 - y0) > 200:
            box = (x0 + 10, y0 + 10, x1 - 10, y1 - 10)
    if box is None:
        box = default
    cache.write_text(json.dumps(list(box)), encoding="utf-8")
    return tuple(box)


def _ff(path: Path) -> str:
    """A path the way ffmpeg's filter parser wants it (Windows drive colons escaped)."""
    return str(path).replace("\\", "/").replace(":", r"\:")


def _dt(text: str) -> str:
    """Text escaped for drawtext (a typographic apostrophe: a straight one ends drawtext's quoted text)."""
    t = str(text).replace("'", "\u2019").replace('"', "\u201d").replace(";", ",").replace("\n", " ")
    return re.sub(r"([\\:%,\[\]])", r"\\\1", t)


def _font(name: str) -> str:
    return _ff(FONTS / name)


def _ass_t(sec: float) -> str:
    """Seconds as an ASS time (h:mm:ss.cc)."""
    sec = max(0.0, float(sec))
    return f"{int(sec // 3600)}:{int(sec % 3600 // 60):02d}:{int(sec % 60):02d}.{int(round((sec % 1) * 100)) % 100:02d}"


def _cue_text(job: Path, start: float, dur: float) -> str:
    """What the narrator says over this slot (the SRT cues overlapping it)."""
    srt = job / "subs.srt"
    if not srt.exists():
        return ""
    out = []
    for block in srt.read_text(encoding="utf-8", errors="ignore").strip().split("\n\n"):
        lines = block.strip().splitlines()
        if len(lines) >= 3 and "-->" in lines[1]:
            def ts(x):
                h, m, s = x.strip().replace(",", ".").split(":")
                return int(h) * 3600 + int(m) * 60 + float(s)
            a, b = [ts(x) for x in lines[1].split("-->")]
            if a < start + dur and b > start:
                out.append(" ".join(lines[2:]))
    return " ".join(out)


# a still ground (a JPEG is full-range yuvj420p) goes to limited-range video before anything is laid on it:
# a full-range frame in the middle of the timeline makes the final subtitles pass fail with "Invalid argument"
GROUND_IN = f"scale={W}:{H}:in_range=auto:out_range=tv,setsar=1,format=yuv420p,setrange=tv,format=rgba"


# ── backgrounds, drawn once ────────────────────────────────────────────────────
def _rng(seed: int):
    import random
    return random.Random(seed)


def _vignette(img, strength: float = 0.75, inner: float = 0.55) -> None:
    from PIL import Image, ImageDraw, ImageFilter
    w, h = img.size
    mask = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(mask)
    d.ellipse([-w * (1 - inner) / 2, -h * (1 - inner) / 2, w * (1 + (1 - inner) / 2), h * (1 + (1 - inner) / 2)], fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(w * 0.16))
    dark = Image.new(img.mode, (w, h), (0, 0, 0) if img.mode == "RGB" else (0, 0, 0, 255))
    img.paste(Image.composite(img, dark, mask.point(lambda v: int(255 - (255 - v) * strength))))


def _mk_chart(p: Path) -> None:
    """An aviation chart on paper: contour lines, a magenta/blue grid, tiny figures, a spotlight vignette."""
    from PIL import Image, ImageDraw, ImageFont
    rnd = _rng(11)
    img = Image.new("RGB", (W, H), (229, 220, 196))
    d = ImageDraw.Draw(img)
    # contours: wandering lines
    for i in range(70):
        x, y = rnd.uniform(-200, W + 200), rnd.uniform(-200, H + 200)
        pts, a = [(x, y)], rnd.uniform(0, 6.28)
        for _ in range(60):
            a += rnd.uniform(-0.6, 0.6)
            x += math.cos(a) * 34
            y += math.sin(a) * 34
            pts.append((x, y))
        d.line(pts, fill=(168, 142, 104), width=1)
    for i in range(0, W, 160):
        d.line([(i, 0), (i, H)], fill=(120, 60, 140), width=1)
    for j in range(0, H, 160):
        d.line([(0, j), (W, j)], fill=(60, 90, 160), width=1)
    try:
        f = ImageFont.truetype(str(FONTS / "ShareTechMono.ttf"), 20)
    except OSError:
        f = ImageFont.load_default()
    for i in range(160):
        d.text((rnd.uniform(0, W), rnd.uniform(0, H)), f"{rnd.randint(11, 99)}{rnd.choice(['', '°', chr(39)])}", fill=(90, 70, 50), font=f)
    for i in range(12):
        cx, cy = rnd.uniform(0, W), rnd.uniform(0, H)
        d.ellipse([cx - 40, cy - 40, cx + 40, cy + 40], outline=(60, 90, 160), width=2)
    _vignette(img, 0.82, 0.5)
    img.save(p, quality=95)


def _mk_bluegrid(p: Path) -> None:
    """A flat blueprint grid: one blue, thin light lines every 48 px, a brighter dot where every fifth line
    crosses (the ground Robin sent for HUSTLE)."""
    from PIL import Image, ImageDraw, ImageFilter
    img = Image.new("RGB", (W, H), (49, 118, 214))
    d = ImageDraw.Draw(img, "RGBA")
    step = 48
    for x in range(0, W + 1, step):
        d.line([(x, 0), (x, H)], fill=(255, 255, 255, 62), width=1)
    for y in range(0, H + 1, step):
        d.line([(0, y), (W, y)], fill=(255, 255, 255, 62), width=1)
    for x in range(0, W + 1, step * 5):
        for y in range(0, H + 1, step * 5):
            d.ellipse([x - 3, y - 3, x + 3, y + 3], fill=(235, 240, 255, 230))
    # a whisper of vignette so the frame has a centre
    glow = Image.new("L", (W, H), 0)
    ImageDraw.Draw(glow).ellipse([-W * 0.2, -H * 0.3, W * 1.2, H * 1.3], fill=255)
    glow = glow.filter(ImageFilter.GaussianBlur(W * 0.25))
    dark = Image.new("RGB", (W, H), (28, 70, 150))
    img = Image.composite(img, dark, glow.point(lambda v: 120 + v * 135 // 255))
    img.save(p)


def _mk_stage(p: Path) -> None:
    from PIL import Image, ImageDraw, ImageFilter
    img = Image.new("RGB", (W, H), (11, 11, 13))
    glow = Image.new("RGB", (W, H), (0, 0, 0))
    d = ImageDraw.Draw(glow)
    d.rounded_rectangle([173 - 40, 97 - 40, 173 + 1574 + 40, 97 + 886 + 40], radius=60, fill=(110, 110, 120))
    glow = glow.filter(ImageFilter.GaussianBlur(70))
    img = Image.blend(img, Image.eval(glow, lambda v: v), 0.5)
    rad = Image.new("L", (W, H), 0)
    ImageDraw.Draw(rad).ellipse([W * 0.15, -H * 0.2, W * 0.85, H * 0.9], fill=70)
    rad = rad.filter(ImageFilter.GaussianBlur(260))
    img = Image.composite(Image.new("RGB", (W, H), (60, 60, 66)), img, rad)
    img.save(p, quality=95)


def _mk_rounded_mask(p: Path, w: int, h: int, r: int) -> None:
    from PIL import Image, ImageDraw
    m = Image.new("L", (w, h), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, w - 1, h - 1], radius=r, fill=255)
    m.save(p)


def _mk_torn_mask(p: Path, w: int, h: int, seed: int) -> None:
    """A panel mask with jagged left and right edges (torn film)."""
    from PIL import Image, ImageDraw
    rnd = _rng(seed)
    m = Image.new("L", (w, h), 0)
    left = [(rnd.uniform(0, 14), y) for y in range(0, h + 40, 40)]
    right = [(w - rnd.uniform(0, 14), y) for y in range(0, h + 40, 40)]
    ImageDraw.Draw(m).polygon(left + right[::-1], fill=255)
    m.save(p)


def _mk_scan(p: Path, alpha: int = 60, vig: float = 0.7) -> None:
    from PIL import Image, ImageDraw, ImageFilter
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for y in range(0, H, 3):
        d.line([(0, y), (W, y)], fill=(0, 0, 0, alpha), width=1)
    v = Image.new("L", (W, H), 0)
    ImageDraw.Draw(v).ellipse([-W * 0.1, -H * 0.15, W * 1.1, H * 1.15], fill=255)
    v = v.filter(ImageFilter.GaussianBlur(W * 0.14))
    dark = Image.new("RGBA", (W, H), (0, 0, 0, int(255 * vig)))
    dark.putalpha(v.point(lambda x: int((255 - x) * vig)))
    img.alpha_composite(dark)
    img.save(p)


def _mk_monitor(p: Path) -> None:
    from PIL import Image, ImageDraw, ImageFilter
    img = Image.new("RGB", (W, H), (8, 37, 44))
    d = ImageDraw.Draw(img)
    for x in range(0, W, 80):
        d.line([(x, 0), (x, H)], fill=(14, 59, 69), width=1)
    for y in range(0, H, 80):
        d.line([(0, y), (W, y)], fill=(14, 59, 69), width=1)
    glow = Image.new("RGB", (W, H), (0, 0, 0))
    ImageDraw.Draw(glow).rounded_rectangle([250 - 30, 140 - 30, 250 + 1420 + 30, 140 + 800 + 30], radius=40, fill=(30, 120, 140))
    img = Image.blend(img, glow.filter(ImageFilter.GaussianBlur(60)), 0.45)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([250 - 18, 140 - 18, 250 + 1420 + 18, 140 + 800 + 18], radius=34, fill=(4, 22, 27), outline=(40, 110, 125), width=3)
    _vignette(img, 0.6, 0.6)
    img.save(p, quality=95)


def _mk_news(p: Path) -> None:
    """The broadcast band (RGBA overlay): a red rule, a navy headline strip with a red BREAKING tab, a yellow hairline,
    a lighter strip for the crawl; the ARCHIVE plate top-left. The LATEST tab is a second file (news_tab.png) laid
    over the crawl."""
    from PIL import Image, ImageDraw, ImageFont
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rectangle([0, 896, W, 903], fill=(224, 50, 43, 255))
    for y in range(903, 992):                      # the headline strip, a gentle navy gradient
        k = (y - 903) / 89
        d.line([(0, y), (W, y)], fill=(int(14 - 4 * k), int(32 - 8 * k), int(58 - 12 * k), 255))
    d.rectangle([0, 992, W, 996], fill=(245, 196, 0, 255))
    d.rectangle([0, 996, W, H], fill=(18, 43, 77, 255))
    d.rectangle([0, 903, 330, 992], fill=(224, 50, 43, 255))
    try:
        f = ImageFont.truetype(str(FONTS / "ArchivoBlack.ttf"), 40)
        f2 = ImageFont.truetype(str(FONTS / "Oswald.ttf"), 28)
    except OSError:
        f = f2 = ImageFont.load_default()
    d.text((165, 947), "BREAKING", fill=(255, 255, 255, 255), font=f, anchor="mm")
    d.rectangle([60, 60, 330, 112], fill=(0, 0, 0, 200))
    d.ellipse([78, 76, 98, 96], fill=(224, 50, 43, 255))
    d.text((112, 68), "ARCHIVE FOOTAGE", fill=(255, 255, 255, 255), font=f2)
    img.save(p)


def _mk_news_tab(p: Path) -> None:
    from PIL import Image, ImageDraw, ImageFont
    img = Image.new("RGBA", (230, 84), (16, 18, 20, 255))
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, 8, 84], fill=(245, 196, 0, 255))
    try:
        f = ImageFont.truetype(str(FONTS / "Oswald.ttf"), 30)
    except OSError:
        f = ImageFont.load_default()
    d.text((124, 42), "LATEST", fill=(255, 255, 255, 255), font=f, anchor="mm")
    img.save(p)


def _mk_paper(p: Path) -> None:
    from PIL import Image, ImageDraw
    rnd = _rng(5)
    img = Image.new("RGB", (W, H), (214, 178, 122))
    d = ImageDraw.Draw(img)
    for i in range(0, W, 240):        # a wooden wall: planks
        d.line([(i, 0), (i, H)], fill=(170, 132, 80), width=6)
        for k in range(30):
            y = rnd.uniform(0, H)
            d.line([(i + 10, y), (i + 230, y + rnd.uniform(-6, 6))], fill=(198, 160, 104), width=1)
    _vignette(img, 0.45, 0.6)
    sheet = Image.new("RGBA", (1440, 860), (250, 241, 214, 255))
    sd = ImageDraw.Draw(sheet)
    sd.rectangle([0, 0, 1439, 859], outline=(42, 29, 18), width=7)
    rot = sheet.rotate(-2, expand=True, resample=Image.BICUBIC)
    shadow = Image.new("RGBA", rot.size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rectangle([20, 26, rot.size[0] - 4, rot.size[1] - 4], fill=(0, 0, 0, 110))
    from PIL import ImageFilter
    shadow = shadow.filter(ImageFilter.GaussianBlur(18))
    x, y = (W - rot.size[0]) // 2, (H - rot.size[1]) // 2 - 10
    img.paste(shadow, (x + 14, y + 22), shadow)
    img.paste(rot, (x, y), rot)
    d = ImageDraw.Draw(img)
    for cx, cy, a in ((x + 60, y + 50, 40), (x + rot.size[0] - 60, y + 30, -35), (x + 40, y + rot.size[1] - 60, -40), (x + rot.size[0] - 80, y + rot.size[1] - 40, 35)):
        tape = Image.new("RGBA", (150, 44), (240, 226, 150, 200))
        tape = tape.rotate(a, expand=True, resample=Image.BICUBIC)
        img.paste(tape, (cx - tape.size[0] // 2, cy - tape.size[1] // 2), tape)
    img.save(p, quality=95)


# ── the treatments ─────────────────────────────────────────────────────────────
def _run(args: list, dst: Path, dur: float) -> bool:
    subprocess.run(args + ["-t", f"{dur:.3f}"] + ENC + [str(dst)], check=True, capture_output=True)
    return dst.exists() and dst.stat().st_size > 2000


def blurfill(seg: Path, dst: Path, dur: float, n: int, cfg: dict) -> bool:
    keyline = str(cfg.get("keyline") or "F4EBDD").lstrip("#")
    if n % 4 == 0:      # the inset: a close-up of the same shot in a yellow frame sliding in over the wide shot
        yl = str(cfg.get("inset") or "F2C230").lstrip("#")
        fc = (f"[0:v]split=2[a][b];[a]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},setsar=1[bg];"
              f"[b]crop=iw/1.7:ih/1.7:(iw-iw/1.7)/2:(ih-ih/1.7)*0.2,scale=440:248,setsar=1,pad=452:260:6:6:color=0x{yl}[in];"
              f"[bg][in]overlay=x='{W}-452-90+(1-min(1,t/0.45))*560':y=90,format=yuv420p[v]")
    else:
        fc = (f"[0:v]split=2[a][b];[a]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},setsar=1,"
              f"gblur=sigma=42,eq=brightness=-0.12:saturation=0.85[bg];"
              f"[b]scale=1416:796:force_original_aspect_ratio=decrease:flags=lanczos,setsar=1,pad=iw+8:ih+8:4:4:color=0x{keyline}[p];"
              f"[bg][p]overlay=(W-w)/2:(H-h)/2,scale=w='{W}*(1+0.022*t/{dur:.3f})':h=-2:eval=frame:flags=bicubic,"
              f"crop={W}:{H},format=yuv420p[v]")
    return _run(["ffmpeg", "-y", "-v", "error", "-i", str(seg), "-filter_complex", fc, "-map", "[v]"], dst, dur)


def print_(seg: Path, dst: Path, dur: float, n: int, cfg: dict) -> bool:
    chart = _ground("chart", "chart.png", _mk_chart)
    ang = -0.045 if n % 2 else 0.035
    stamp = _png(f"evidence_{n % 4}.png", lambda p: _mk_evidence(p, n))
    # the torch: a soft bright disc travelling over the chart once, screen-blended; a faint flicker in the lamp light
    tt = f"min(1\\,T/{max(1.0, dur - 0.6):.2f})"
    disc = f"exp(-((X-(W*0.2+W*0.6*{tt}))^2+(Y-(H*0.35+H*0.3*{tt}))^2)/(2*43*43))"
    # the beam is computed small (geq is per pixel) and scaled up: a soft disc needs no resolution
    torch = (f"color=c=black:s=320x180:r={FPS}:d={dur:.3f},format=gbrp,"
             f"geq=r='255*{disc}*0.55':g='255*{disc}*0.50':b='255*{disc}*0.38',scale={W}:{H}:flags=bicubic[tor]")
    fc = (f"[0:v]scale=1340:754:force_original_aspect_ratio=decrease:flags=lanczos,setsar=1,pad=iw+24:ih+24:12:12:color=0xF3EEE0,"
          f"eq=saturation=0.85:contrast=1.06,format=rgba,rotate={ang}:c=none:ow=rotw({ang}):oh=roth({ang}),split=2[p][ps];"
          f"[ps]colorchannelmixer=rr=0:gg=0:bb=0:aa=0.6,gblur=sigma=24[sh];"
          f"[1:v]{GROUND_IN},eq=brightness='-0.02+0.03*sin(t*11)+0.02*sin(t*29)':eval=frame[g];"
          f"[g][sh]overlay=x=(W-w)/2+34:y=(H-h)/2+40[g1];"
          f"[g1][p]overlay=x='(W-w)/2+9*sin(t/2.2)':y='(H-h)/2+6*cos(t/3.1)'[g2];"
          f"[2:v]format=rgba[st];[g2][st]overlay=x='W-w-140+4*sin(t/2.2)':y='120+3*cos(t/3.1)':enable='gte(t,0.35)'[g3];"
          f"{torch};[g3]format=gbrp[g3b];[g3b][tor]blend=all_mode=screen:shortest=1,format=yuv420p,"
          f"scale=w='{W}*(1+0.03*t/{dur:.3f})':h=-2:eval=frame:flags=bicubic,crop={W}:{H},format=yuv420p[v]")
    return _run(["ffmpeg", "-y", "-v", "error", "-i", str(seg), "-loop", "1", "-i", str(chart), "-loop", "1", "-i", str(stamp),
                 "-filter_complex", fc, "-map", "[v]"], dst, dur)


def _mk_evidence(p: Path, n: int = 0) -> None:
    """A red rubber stamp: EVIDENCE, a case number and a date line, slightly rotated, worn (RGBA)."""
    from PIL import Image, ImageDraw, ImageFont, ImageFilter
    import random
    rnd = random.Random(31 + n)
    W_, H_ = 520, 210
    img = Image.new("RGBA", (W_, H_), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    try:
        f1 = ImageFont.truetype(str(FONTS / "SpecialElite.ttf"), 74)
        f2 = ImageFont.truetype(str(FONTS / "CourierPrime-Bold.ttf"), 30)
    except OSError:
        f1 = f2 = ImageFont.load_default()
    red = (214, 30, 24, 235)
    d.rounded_rectangle([6, 6, W_ - 7, H_ - 7], radius=10, outline=red, width=7)
    d.text((W_ // 2, 74), "EVIDENCE", fill=red, font=f1, anchor="mm")
    d.text((W_ // 2, 150), f"CASE {rnd.randint(11, 98)}-{rnd.randint(1000, 9999)}  ·  ITEM {n + 1:02d}", fill=red, font=f2, anchor="mm")
    # worn ink: knock holes out of the stamp with noise
    noise = Image.effect_noise((W_, H_), 90).point(lambda v: 255 if v > 92 else int(v * 2.2))
    a = img.split()[3]
    from PIL import ImageChops
    img.putalpha(ImageChops.multiply(a, noise))
    img = img.rotate(-7 + rnd.uniform(-3, 3), resample=Image.BICUBIC, expand=True)
    img.filter(ImageFilter.GaussianBlur(0.4)).save(p)


def page(seg: Path, dst: Path, dur: float, n: int, cfg: dict, job: Path, start: float) -> bool:
    line = _cue_text(job, start, dur).strip()
    if len(line) > 110:
        line = line[:107].rsplit(" ", 1)[0] + "…"
    ass = dst.with_suffix(".ass")
    body = ""
    if line:
        per = max(1, int(round(min(0.05, max(0.4, dur - 1.0) * 0.8 / max(1, len(line))) * 100)))
        rows = []
        cur = ""
        for w in line.split():
            if cur and len(cur) + 1 + len(w) > 48:
                rows.append(cur)
                cur = w
            else:
                cur = (cur + " " + w).strip()
        if cur:
            rows.append(cur)
        text = "\\N".join("".join(f"{{\\k{per}}}{c}" for c in r.replace("{", "(").replace("}", ")")) for r in rows[:2])
        body = (f"Dialogue: 0,0:00:00.40,{_ass_t(dur)},Page,,0,0,0,,"
                f"{{\\pos(960,800)}}{text}\n")
    ass.write_text("[Script Info]\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\nWrapStyle: 2\nScaledBorderAndShadow: yes\n\n"
                   "[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, "
                   "Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n"
                   "Style: Page,Inter Bold,50,&H00141414,&HFFFFFFFF,&H00FAFAF8,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,8,0,0,0,1\n\n"
                   "[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n" + body, encoding="utf-8")
    fontsdir = _ff(FONTS)
    fc = (f"color=c=0xFAFAF8:s={W}x{H}:r={FPS}:d={dur:.3f},format=yuv420p[g];"
          f"color=c=black:s=1260x735:r={FPS}:d={dur:.3f},format=yuva420p,"
          f"geq=lum='16':cb='128':cr='128':a='255*0.32*clip(min(min(X,W-X),min(Y,H-Y))/30,0,1)',gblur=sigma=22[sh];"
          f"[0:v]scale=1200:675:force_original_aspect_ratio=increase:flags=lanczos,crop=1200:675,setsar=1[p];"
          f"[g][sh]overlay=330:150[g1];[g1][p]overlay=360:110[g2];"
          f"[g2]subtitles='{_ff(ass)}':fontsdir='{fontsdir}',format=yuv420p[v]")
    ok = _run(["ffmpeg", "-y", "-v", "error", "-i", str(seg), "-filter_complex", fc, "-map", "[v]"], dst, dur)
    ass.unlink(missing_ok=True)
    return ok


def stage(seg: Path, dst: Path, dur: float, n: int, cfg: dict) -> bool:
    # look.cinema.ground picks another ground under the stage: a generated gen_<name>.jpg, or a drawn one
    # ("bluegrid": the flat blueprint grid)
    name = str(cfg.get("ground") or "stage")
    bg = _ground(name, f"{name}.png", {"bluegrid": _mk_bluegrid}.get(name, _mk_stage))
    mask = _png("stage_mask.png", lambda p: _mk_rounded_mask(p, 1574, 886, 42))
    fc = (f"[0:v]scale=1574:886:force_original_aspect_ratio=increase:flags=lanczos,crop=1574:886,setsar=1,format=rgba[p];"
          f"[2:v]format=gray[m];[p][m]alphamerge[pm];"
          f"color=c=black:s=1640x950:r={FPS}:d={dur:.3f},format=yuva420p,"
          f"geq=lum='16':cb='128':cr='128':a='255*0.7*clip(min(min(X,W-X),min(Y,H-Y))/34,0,1)',gblur=sigma=26[sh];"
          f"[1:v]{GROUND_IN}[g];[g][sh]overlay=140:96[g1];[g1][pm]overlay=173:97,"
          f"scale=w='{W}*(1+0.025*t/{dur:.3f})':h=-2:eval=frame:flags=bicubic,crop={W}:{H},format=yuv420p[v]")
    return _run(["ffmpeg", "-y", "-v", "error", "-i", str(seg), "-loop", "1", "-i", str(bg), "-loop", "1", "-i", str(mask),
                 "-filter_complex", fc, "-map", "[v]"], dst, dur)


def crt(seg: Path, dst: Path, dur: float, n: int, cfg: dict) -> bool:
    scan = _png("scan.png", lambda p: _mk_scan(p, 62, 0.72))
    if n % 3 == 0:      # the triptych: three crops of the shot side by side, torn edges between them
        masks = [_png(f"tri_mask_{i}.png", (lambda i: lambda p: _mk_torn_mask(p, 640, H, 40 + i))(i)) for i in range(3)]
        fc = (f"[0:v]scale=-2:{H}:flags=lanczos,setsar=1,eq=contrast=1.08:saturation=1.05,colorbalance=rs=.06:bs=-.06,split=3[a][b][c];"
              f"[a]crop=640:{H}:0:0,format=rgba[a1];[b]crop=640:{H}:(iw-640)/2:0,format=rgba[b1];[c]crop=640:{H}:iw-640:0,format=rgba[c1];"
              f"[2:v]format=gray[m0];[3:v]format=gray[m1];[4:v]format=gray[m2];"
              f"[a1][m0]alphamerge[am];[b1][m1]alphamerge[bm];[c1][m2]alphamerge[cm];"
              f"color=c=black:s={W}x{H}:r={FPS}:d={dur:.3f},format=rgba[bk];"
              f"[bk][am]overlay=0:0[o1];[o1][bm]overlay=640:0[o2];[o2][cm]overlay=1280:0[o3];[o3][1:v]overlay=0:0,format=yuv420p[v]")
        return _run(["ffmpeg", "-y", "-v", "error", "-i", str(seg), "-loop", "1", "-i", str(scan)] +
                    sum([["-loop", "1", "-i", str(m)] for m in masks], []) + ["-filter_complex", fc, "-map", "[v]"], dst, dur)
    mask = _png("crt_mask.png", lambda p: _mk_torn_mask(p, 608, H, 21))
    fc = (f"[0:v]split=2[a][b];[a]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},setsar=1,"
          f"gblur=sigma=36,eq=brightness=-0.38:saturation=0.55[bg];"
          f"[b]scale=-2:{H}:flags=lanczos,setsar=1,crop=608:{H}:(iw-608)/2:0,eq=contrast=1.08:saturation=1.05,colorbalance=rs=.06:bs=-.06,format=rgba[c];"
          f"[2:v]format=gray[m];[c][m]alphamerge[cm];[bg][cm]overlay=656:0[g];[g][1:v]overlay=0:0,format=yuv420p[v]")
    return _run(["ffmpeg", "-y", "-v", "error", "-i", str(seg), "-loop", "1", "-i", str(scan), "-loop", "1", "-i", str(mask),
                 "-filter_complex", fc, "-map", "[v]"], dst, dur)


def monitor(seg: Path, dst: Path, dur: float, n: int, cfg: dict, start: float) -> bool:
    """A channel may re-skin it in look.cinema: monitor_ground (gen_<name>.jpg in assets/kits/frames), monitor_grade
    (the ffmpeg filter on the picture), monitor_label_colour / monitor_tc_colour ("#RRGGBB"), monitor_glow (a
    "#RRGGBB" halo round both), monitor_label_font (a bundled .ttf) and monitor_text_scale (1 = DEEP's size)."""
    bg = _ground(str(cfg.get("monitor_ground") or "monitor"), "monitor.png", _mk_monitor)
    x0, y0, x1, y1 = _dark_box(bg, (250, 140, 1670, 940)) if bg.name.startswith("gen_") else (250, 140, 1670, 940)
    sw, sh = (x1 - x0) // 2 * 2, (y1 - y0) // 2 * 2
    mask = _png(f"monitor_mask_{sw}x{sh}.png", lambda p: _mk_rounded_mask(p, sw, sh, 26))
    scan = _png("scan_light.png", lambda p: _mk_scan(p, 34, 0.35))
    tc = f"{int(start // 60):02d}:{int(start % 60):02d}:{int((start % 1) * 30):02d}"
    label = str(cfg.get("monitor_label") or "ARCHIVE")
    fs = max(22, int(sh * 0.042 * float(cfg.get("monitor_text_scale") or 1.0)))
    hexc = lambda k, d: "0x" + (str(cfg.get(k) or d).lstrip("#") if len(str(cfg.get(k) or d).lstrip("#")) == 6 else d.lstrip("#"))
    lab_c, tc_c = hexc("monitor_label_colour", "#9FD8DF"), hexc("monitor_tc_colour", "#4FE3FF")
    glow = (f":bordercolor={hexc('monitor_glow', '#000000')}@0.45:borderw={max(3, fs // 9)}" if cfg.get("monitor_glow") else "")
    lab_font = _font(str(cfg.get("monitor_label_font") or "SairaStencilOne.ttf"))
    grade = str(cfg.get("monitor_grade") or "colorbalance=rs=-.14:gs=.02:bs=.12,eq=saturation=.72:contrast=1.1:brightness=-0.02")
    tc_w = max(160, int(fs * 0.62 * len(tc)) + 40) if cfg.get("monitor_text_scale") else 160
    cw, ch, cx, cy = _autocrop(seg)
    crop = f"crop={cw}:{ch}:{cx}:{cy}," if cw else ""
    fc = (f"[0:v]{crop}split=2[pa][pb];"
          f"[pa]scale={sw}:{sh}:force_original_aspect_ratio=increase:flags=lanczos,crop={sw}:{sh},setsar=1,gblur=sigma=30,"
          f"eq=brightness=-0.2:saturation=.5[pbg];"
          f"[pb]scale={sw}:{sh}:force_original_aspect_ratio=decrease:flags=lanczos,setsar=1[pfg];"
          f"[pbg][pfg]overlay=(W-w)/2:(H-h)/2,"
          f"{grade},format=rgba[p];"
          f"[2:v]format=gray[m];[p][m]alphamerge[pm];[1:v]{GROUND_IN}[g];[g][pm]overlay={x0}:{y0}[g1];"
          f"[g1][3:v]overlay=0:0,"
          f"drawtext=fontfile='{lab_font}':text='{_dt(label)}':fontsize={fs}:fontcolor={lab_c}{glow}:x={x0 + 30}:y={y0 + 26},"
          + (f"drawtext=fontfile='{_font('SpaceMono-Bold.ttf')}':text='{_dt(tc)}':fontsize={max(20, fs - 6)}:fontcolor={tc_c}{glow}:"
             f"x={x1 - tc_w}:y={y0 + 28}," if cfg.get("monitor_timecode", True) is not False else "") +
          f"format=yuv420p[v]")
    return _run(["ffmpeg", "-y", "-v", "error", "-i", str(seg), "-loop", "1", "-i", str(bg), "-loop", "1", "-i", str(mask),
                 "-loop", "1", "-i", str(scan), "-filter_complex", fc, "-map", "[v]"], dst, dur)


def news(seg: Path, dst: Path, dur: float, n: int, cfg: dict, job: Path, start: float) -> bool:
    band = _png("news2.png", _mk_news)
    tab = _png("news_tab.png", _mk_news_tab)
    line = re.sub(r"\s+", " ", _cue_text(job, start, dur).strip() or str(cfg.get("ticker") or ""))[:220]
    words = line.split()
    head = " ".join(words[:8]).rstrip(",.;:") if words else ""
    if len(head) > 54:
        head = head[:52].rsplit(" ", 1)[0]
    texts = ""
    if head:
        texts += (f",drawtext=fontfile='{_font('Oswald.ttf')}':text='{_dt(head.upper())}':fontsize=50:fontcolor=white:"
                  f"x=366:y=918:alpha='min(1\\,t*3)'")
    if line:
        texts += (f",drawtext=fontfile='{_font('Oswald.ttf')}':text='{_dt(line.upper())}':fontsize=34:fontcolor=white:"
                  f"y=1020:x='{W}-mod(t*170\\,{W}+tw)'")
    fc = (f"[0:v]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},setsar=1,"
          f"scale=w='{W}*(1+0.02*t/{dur:.3f})':h=-2:eval=frame:flags=bicubic,crop={W}:{H}[p];"
          f"[p][1:v]overlay=0:0{texts}[p2];"
          f"[p2][2:v]overlay=0:996,format=yuv420p[v]")
    return _run(["ffmpeg", "-y", "-v", "error", "-i", str(seg), "-loop", "1", "-i", str(band), "-loop", "1", "-i", str(tab),
                 "-filter_complex", fc, "-map", "[v]"], dst, dur)


_TOTAL: dict = {}


def _job_total(job: Path) -> float:
    """The length of the narration (audio.mp3), cached per job — 600 s when unknown."""
    k = str(job)
    if k not in _TOTAL:
        try:
            _TOTAL[k] = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0",
                                              str(job / "audio.mp3")], capture_output=True, text=True, timeout=30).stdout.strip() or 600)
        except (subprocess.SubprocessError, OSError, ValueError):
            _TOTAL[k] = 600.0
    return max(30.0, _TOTAL[k])


def _title_line(job: Path, limit: int = 64) -> str:
    try:
        t = (job / "title.txt").read_text(encoding="utf-8").splitlines()[0].strip()
    except (OSError, IndexError):
        t = ""
    return (t[: limit - 1] + "…") if len(t) > limit else t


def player(seg: Path, dst: Path, dur: float, n: int, cfg: dict, job: Path, start: float) -> bool:
    """TAPE: the shot inside a player window on the dark studio — rounded, a soft shadow, a red progress bar that
    keeps moving, a running m:ss timecode and the episode's title in the control bar."""
    bg = _ground("studio", "studio.png", _mk_studio)
    cw, ch, bar, x0, y0 = 1320, 742, 56, 300, 70
    mask = _png(f"player_mask_{cw}x{ch + bar}.png", lambda p: _mk_rounded_mask(p, cw, ch + bar, 24))
    total = _job_total(job)
    px = int(cw * min(0.96, max(0.02, start / total)))
    off = int(start)
    mono, semi = _font("SpaceMono-Bold.ttf"), _font("Inter-SemiBold.ttf")
    cw_, ch_, cx_, cy_ = _autocrop(seg)
    crop = f"crop={cw_}:{ch_}:{cx_}:{cy_}," if cw_ else ""
    fc = (f"[0:v]{crop}scale={cw}:{ch}:force_original_aspect_ratio=increase:flags=lanczos,crop={cw}:{ch},setsar=1,"
          f"pad={cw}:{ch + bar}:0:0:color=0x111214,"
          f"drawbox=x=0:y={ch}:w={cw}:h=6:color=0x3A3B40:t=fill,"
          f"drawtext=fontfile='{semi}':text='{_dt(_title_line(job))}':fontsize=24:fontcolor=0xF2F2F2:x=34:y={ch + 19},"
          f"drawtext=fontfile='{mono}':text='%{{pts\\:gmtime\\:{off}\\:%M}}\\:%{{pts\\:gmtime\\:{off}\\:%S}}':fontsize=22:fontcolor=0x9AA0A6:x={cw - 150}:y={ch + 20},"
          f"format=rgba[w];"
          f"color=c=0xFF0033:s={cw}x6:r={FPS}:d={dur:.3f}[red];"
          f"[w][red]overlay=x='-{cw}+{px}+{cw / total:.4f}*t':y={ch}[w2];"
          f"[2:v]format=gray[m];[w2][m]alphamerge[wm];"
          f"color=c=black:s={cw + 80}x{ch + bar + 80}:r={FPS}:d={dur:.3f},format=yuva420p,"
          f"geq=lum='16':cb='128':cr='128':a='255*0.78*clip(min(min(X,W-X),min(Y,H-Y))/40,0,1)',gblur=sigma=30[sh];"
          f"[1:v]{GROUND_IN},eq=brightness=-0.04[g];[g][sh]overlay={x0 - 40}:{y0 - 6}[g1];[g1][wm]overlay={x0}:{y0},"
          f"scale=w='{W}*(1+0.02*t/{dur:.3f})':h=-2:eval=frame:flags=bicubic,crop={W}:{H},format=yuv420p[v]")
    return _run(["ffmpeg", "-y", "-v", "error", "-i", str(seg), "-loop", "1", "-i", str(bg), "-loop", "1", "-i", str(mask),
                 "-filter_complex", fc, "-map", "[v]"], dst, dur)


def _mk_studio(p: Path) -> None:
    """A dark studio wall with one warm key light (fallback for gen_studio.jpg)."""
    from PIL import Image, ImageFilter, ImageDraw, ImageChops
    img = Image.new("RGB", (W, H), (22, 23, 27))
    key = Image.new("RGB", (W, H), (0, 0, 0))
    ImageDraw.Draw(key).ellipse([-300, -500, 1100, 700], fill=(70, 58, 46))
    key = key.filter(ImageFilter.GaussianBlur(260))
    img = ImageChops.add(img, key)
    _vignette(img, 0.5, 0.5)
    img.save(p)


def board(seg: Path, dst: Path, dur: float, n: int, cfg: dict, job: Path, start: float) -> bool:
    """KINETIC: the shot pinned to a chalkboard with a chalk-drawn frame, the narrator's line written under it in chalk."""
    bg = _ground("sketchboard", "board.png", _mk_board)
    chalk = _png(f"chalk_frame_{n % 5}.png", (lambda k: lambda p: _mk_chalk_frame(p, k))(n))
    line = _cue_text(job, start, dur).strip()
    if len(line) > 96:
        line = line[:93].rsplit(" ", 1)[0] + "…"
    ass = dst.with_suffix(".ass")
    body = ""
    if line:
        per = max(1, int(round(min(0.05, max(0.4, dur - 1.0) * 0.8 / max(1, len(line))) * 100)))
        rows, cur = [], ""
        for w in line.split():
            if cur and len(cur) + 1 + len(w) > 44:
                rows.append(cur)
                cur = w
            else:
                cur = (cur + " " + w).strip()
        if cur:
            rows.append(cur)
        text = "\\N".join("".join(f"{{\\k{per}}}{c}" for c in r.replace("{", "(").replace("}", ")")) for r in rows[:2])
        body = (f"Dialogue: 0,0:00:00.45,{_ass_t(dur)},Chalk,,0,0,0,,"
                f"{{\\pos(960,838)\\blur0.6}}{text}\n")
    ass.write_text("[Script Info]\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\nWrapStyle: 2\nScaledBorderAndShadow: yes\n\n"
                   "[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, "
                   "Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n"
                   "Style: Chalk,Kode Mono,46,&H00F2F2EA,&HFFFFFFFF,&H00202020,&H00000000,0,0,0,0,100,100,1,0,1,0.4,0,8,0,0,0,1\n\n"
                   "[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n" + body, encoding="utf-8")
    fontsdir = _ff(FONTS)
    cw_, ch_, cx_, cy_ = _autocrop(seg)
    crop = f"crop={cw_}:{ch_}:{cx_}:{cy_}," if cw_ else ""
    fc = (f"[0:v]{crop}scale=1200:675:force_original_aspect_ratio=increase:flags=lanczos,crop=1200:675,setsar=1,"
          f"pad=1212:687:6:6:color=0xF2F2EA,format=rgba[p];"
          f"[1:v]{GROUND_IN},eq=brightness=-0.03[g];"
          f"[g][p]overlay=x='354+3*sin(t/2.7)':y='94+2*cos(t/3.3)'[g1];"
          f"[2:v]format=rgba,fade=in:st=0.1:d=0.45:alpha=1[ch];[g1][ch]overlay=0:0[g2];"
          f"[g2]subtitles='{_ff(ass)}':fontsdir='{fontsdir}',"
          f"scale=w='{W}*(1+0.02*t/{dur:.3f})':h=-2:eval=frame:flags=bicubic,crop={W}:{H},format=yuv420p[v]")
    ok = _run(["ffmpeg", "-y", "-v", "error", "-i", str(seg), "-loop", "1", "-i", str(bg), "-loop", "1", "-i", str(chalk),
               "-filter_complex", fc, "-map", "[v]"], dst, dur)
    ass.unlink(missing_ok=True)
    return ok


def _mk_board(p: Path) -> None:
    """A dark chalkboard with smudges (fallback for gen_sketchboard.jpg)."""
    from PIL import Image, ImageFilter, ImageDraw
    rnd = _rng(9)
    img = Image.new("RGB", (W, H), (30, 34, 32))
    d = ImageDraw.Draw(img)
    for _ in range(60):
        x, y = rnd.uniform(0, W), rnd.uniform(0, H)
        d.ellipse([x - 200, y - 60, x + 200, y + 60], fill=(38 + rnd.randint(0, 10), 42 + rnd.randint(0, 10), 40))
    img = img.filter(ImageFilter.GaussianBlur(40))
    _vignette(img, 0.45, 0.6)
    img.save(p)


def _mk_chalk_frame(p: Path, n: int = 0) -> None:
    """A chalk-drawn frame round the pinned shot: two passes of a slightly wavy white line (a hand, not a ruler),
    a small arrow doodle, worn like chalk."""
    from PIL import Image, ImageDraw, ImageFilter, ImageChops
    import math
    rnd = _rng(41 + n)
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    x0, y0, x1, y1 = 342, 82, 1578, 793

    def wave(k: int):
        f1, f2, p1, p2 = rnd.uniform(1.5, 3), rnd.uniform(5, 9), rnd.uniform(0, 6), rnd.uniform(0, 6)
        amp = 2.0 + k * 1.5
        return lambda u: amp * (math.sin(u * f1 * 6.283 + p1) + 0.5 * math.sin(u * f2 * 6.283 + p2))

    for k in range(2):
        wx, wy = wave(k), wave(k)
        off = 10 + k * 6
        pts = []
        for i in range(0, 61):
            u = i / 60
            pts.append((x0 + (x1 - x0) * u, y0 - off + wy(u)))
        for i in range(1, 36):
            u = i / 35
            pts.append((x1 + off + wx(u), y0 + (y1 - y0) * u))
        for i in range(1, 61):
            u = i / 60
            pts.append((x1 - (x1 - x0) * u, y1 + off + wy(u + 1)))
        for i in range(1, 36):
            u = i / 35
            pts.append((x0 - off + wx(u + 1), y1 - (y1 - y0) * u))
        d.line(pts + [pts[0]], fill=(245, 245, 235, 200 - k * 60), width=5 - k, joint="curve")
    ax, ay = 1690 + rnd.uniform(-10, 10), 690 + rnd.uniform(-10, 10)
    curve = [(ax, ay), (ax - 20, ay + 50), (ax - 30, ay + 100), (ax - 70, ay + 150)]
    d.line(curve, fill=(245, 245, 235, 215), width=5, joint="curve")
    d.line([(ax - 70, ay + 150), (ax - 34, ay + 146)], fill=(245, 245, 235, 215), width=5)
    d.line([(ax - 70, ay + 150), (ax - 62, ay + 116)], fill=(245, 245, 235, 215), width=5)
    for _ in range(3):
        x, y = rnd.choice([120, 1760]) + rnd.uniform(-40, 40), rnd.choice([150, 920]) + rnd.uniform(-40, 40)
        d.line([(x - 14, y), (x + 14, y)], fill=(245, 245, 235, 170), width=3)
        d.line([(x, y - 14), (x, y + 14)], fill=(245, 245, 235, 170), width=3)
    noise = Image.effect_noise((W, H), 70).point(lambda v: 255 if v > 60 else int(v * 3))
    img.putalpha(ImageChops.multiply(img.split()[3], noise))
    img.filter(ImageFilter.GaussianBlur(0.8)).save(p)


def paper(seg: Path, dst: Path, dur: float, n: int, cfg: dict) -> bool:
    bg = _ground("wall", "paper.png", _mk_paper)
    ang = -0.035
    fc = (f"[0:v]scale=1340:754:force_original_aspect_ratio=increase:flags=lanczos,crop=1340:754,setsar=1,"
          f"format=rgba,rotate={ang}:c=none:ow=rotw({ang}):oh=roth({ang})[p];"
          f"[1:v]{GROUND_IN}[g];[g][p]overlay=x=(W-w)/2:y=(H-h)/2-12,"
          f"scale=w='{W}*(1+0.02*t/{dur:.3f})':h=-2:eval=frame:flags=bicubic,crop={W}:{H},format=yuv420p[v]")
    return _run(["ffmpeg", "-y", "-v", "error", "-i", str(seg), "-loop", "1", "-i", str(bg), "-filter_complex", fc, "-map", "[v]"], dst, dur)


def _autocrop(seg: Path) -> tuple:
    """(w, h, x, y) of the picture inside a shot's black bars (cropdetect over a few frames), or (0, 0, 0, 0)."""
    try:
        p = subprocess.run(["ffmpeg", "-v", "info", "-ss", "0.5", "-t", "1.5", "-i", str(seg), "-vf", "cropdetect=24:2:0",
                            "-f", "null", "-"], capture_output=True, text=True, timeout=60)
        m = re.findall(r"crop=(\d+):(\d+):(\d+):(\d+)", p.stderr)
        if not m:
            return (0, 0, 0, 0)
        w, h, x, y = [int(v) for v in m[-1]]
        # only black BARS are cropped away: the picture must still be most of the frame (a dark shot with one bright
        # patch would otherwise zoom into the patch), and its shape must stay a picture's
        try:
            fw, fh = [int(v) for v in subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                                                       "stream=width,height", "-of", "csv=p=0", str(seg)],
                                                      capture_output=True, text=True, timeout=30).stdout.strip().split(",")[:2]]
        except (ValueError, subprocess.SubprocessError, OSError):
            fw, fh = 1920, 1080
        if w < fw * 0.55 or h < fh * 0.55 or (w >= fw - 16 and h >= fh - 16) or not (1.15 <= w / max(1, h) <= 2.5):
            return (0, 0, 0, 0)
        return (w // 2 * 2, h // 2 * 2, x, y)
    except (subprocess.SubprocessError, OSError, ValueError):
        return (0, 0, 0, 0)


def _mk_deck_strip(p: Path, w: int = W, h: int = 56) -> None:
    """The film-strip scrubber under the window: ticks of three heights, a longer one
    every seventh, drawn once and overlaid. It is furniture, not data — it says
    'you are inside a piece of footage' without pretending to a real timecode."""
    from PIL import Image, ImageDraw
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    i = 0
    x = 20
    while x < w - 20:
        th = 14 + (26 if i % 7 == 0 else (16 if i % 3 == 0 else 8))
        d.rectangle([x, (h - th) // 2, x + 2, (h + th) // 2], fill=(201, 201, 206, 210))
        x += 19
        i += 1
    img.save(p)


def deck(seg: Path, dst: Path, dur: float, n: int, cfg: dict, job: Path, start: float) -> bool:
    """PULSE: the shot inside a lime-keylined window on near-black, a film-strip under it
    and the chapter this update is — 04/12. The footage keeps its own aspect inside the
    window (letterboxed against a blurred copy of itself) so a vertical phone capture or a
    4:3 archive clip is never stretched."""
    x0, y0 = 400, 100
    sw, sh = 1240, 700
    mask = _png(f"deck_mask_{sw}x{sh}.png", lambda p: _mk_rounded_mask(p, sw, sh, 14))
    strip = _png("deck_strip.png", _mk_deck_strip)
    lime = str(cfg.get("deck_lime") or "0xBEF242")          # ffmpeg colour is RRGGBB
    total = max(1, int(cfg.get("deck_of") or 12))
    idx = int(cfg.get("deck_n") or (n % total) + 1)
    cw, ch, cx, cy = _autocrop(seg)
    crop = f"crop={cw}:{ch}:{cx}:{cy}," if cw else ""
    fc = (f"[0:v]{crop}split=2[pa][pb];"
          f"[pa]scale={sw}:{sh}:force_original_aspect_ratio=increase:flags=lanczos,crop={sw}:{sh},setsar=1,"
          f"gblur=sigma=26,eq=brightness=-0.16:saturation=.55[pbg];"
          f"[pb]scale={sw}:{sh}:force_original_aspect_ratio=decrease:flags=lanczos,setsar=1[pfg];"
          f"[pbg][pfg]overlay=(W-w)/2:(H-h)/2,eq=contrast=1.06:saturation=.96,format=rgba[p];"
          f"[2:v]format=gray[m];[p][m]alphamerge[pm];"
          f"[1:v]{GROUND_IN}[g];[g][pm]overlay={x0}:{y0}[g1];"
          # the keyline, drawn as two rectangles rather than a box filter so the corners stay square-bright
          f"[g1]drawbox=x={x0 - 2}:y={y0 - 2}:w={sw + 4}:h={sh + 4}:color={lime}@0.95:t=2[g2];"
          f"[g2][3:v]overlay=0:930[g3];"
          f"[g3]drawtext=fontfile='{_font('SpaceMono-Bold.ttf')}':text='{_dt(f'{idx:02d}')}':fontsize=30:"
          f"fontcolor={lime}:x=(w-tw)/2-26:y=999:box=1:boxcolor=black@0:boxborderw=6,"
          f"drawtext=fontfile='{_font('SpaceMono-Bold.ttf')}':text='{_dt(f'/{total}')}':fontsize=30:"
          f"fontcolor=0x8E8A8A:x=(w-tw)/2+26:y=999,"
          f"format=yuv420p[v]")
    return _run(["ffmpeg", "-y", "-v", "error", "-i", str(seg),
                 "-f", "lavfi", "-i", f"color=c=0x0D0D0D:s={W}x{H}",
                 "-loop", "1", "-i", str(mask), "-loop", "1", "-i", str(strip),
                 "-filter_complex", fc, "-map", "[v]"], dst, dur)


KINDS = ("blurfill", "print", "page", "stage", "crt", "monitor", "news", "paper", "player", "board", "deck")


def treat(mv, kind: str, seg: Path, dst: Path, dur: float, cfg: dict, job: Path, start: float, n: int) -> bool:
    try:
        if kind == "blurfill":
            return blurfill(seg, dst, dur, n, cfg)
        if kind == "print":
            return print_(seg, dst, dur, n, cfg)
        if kind == "page":
            return page(seg, dst, dur, n, cfg, job, start)
        if kind == "stage":
            return stage(seg, dst, dur, n, cfg)
        if kind == "crt":
            return crt(seg, dst, dur, n, cfg)
        if kind == "monitor":
            return monitor(seg, dst, dur, n, cfg, start)
        if kind == "news":
            return news(seg, dst, dur, n, cfg, job, start)
        if kind == "paper":
            return paper(seg, dst, dur, n, cfg)
        if kind == "player":
            return player(seg, dst, dur, n, cfg, job, start)
        if kind == "board":
            return board(seg, dst, dur, n, cfg, job, start)
        if kind == "deck":
            return deck(seg, dst, dur, n, cfg, job, start)
        _log(mv, f"frames: unknown frame kind {kind!r}")
        return False
    except subprocess.CalledProcessError as e:
        _log(mv, f"  frames: {kind} on slot {n} skipped — {str(e.stderr or e)[-160:]}")
        return False
    except Exception as e:                            # noqa: BLE001
        _log(mv, f"  frames: {kind} on slot {n} skipped — {type(e).__name__}: {str(e)[:120]}")
        return False


if __name__ == "__main__":
    # python frames.py <kind> <clip.mp4> [out.mp4]  -> a quick look at one treatment
    import sys
    if len(sys.argv) >= 3:
        k, src = sys.argv[1], Path(sys.argv[2])
        out = Path(sys.argv[3]) if len(sys.argv) > 3 else HERE / "preview" / f"frame_{k}.mp4"
        out.parent.mkdir(parents=True, exist_ok=True)
        d = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(src)],
                                 capture_output=True, text=True).stdout.strip() or 4)
        print(k, treat(None, k, src, out, min(6.0, d), {}, HERE / "output", 12.0, 3), out)
    else:
        print(__doc__)
