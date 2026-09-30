#!/usr/bin/env python3
"""satfx.py — three more satellite map skills for documentaries, in the look of the satellite zoom (satzoom.py).

    range      How far something reaches. Rings spread from a place across a 3D globe (or across the satellite
               map, for a short reach), a counter runs up the distance, and every city a ring passes lights up —
               a missile's range, artillery aimed at a capital, an exclusion zone.
    then_now   A place then and now. The camera hovers over it on archived satellite imagery (Esri Wayback) and
               a line of light sweeps across, turning the picture into today's, then settles in the middle as a
               before/after split — a street built in a year, a camp that doubled, a town that was destroyed.
               The years on screen are the imagery's real capture dates.
    night      Night falls over a region. The shadow line crosses the land with the sunset glowing along it, the
               real lights of its cities come on (NASA Black Marble) and its borders draw in — North Korea dark
               beside a lit South.

Each renders to an mp4 with <mp4>.sfx.json sound marks beside it, like a zoom; maps.py hands them their moments
(map shots "range", "then_now", "night") and the director picks them. Python (numpy + Pillow) only, no browser.

    python satfx.py range "Pyongyang" --km 1300 4500 --targets Tokyo Guam --title "Hwasong-12" --kicker "dolet až 4 500 km"
    python satfx.py then_now "Ryomyong Street" --city Pyongyang --country "North Korea" --then 2015 --title "Ulice Rjomjong"
    python satfx.py night "Korea" --lat 38.4 --lon 127.4 --span 900 --labels Pyongyang Seoul --borders "North Korea" --title "Korea v noci"
    (any of them with --frames 1.0 4.0 7.5 for stills instead of a video)
"""

import json
import math
import re
import shutil
import subprocess
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

import satzoom as sz
from satzoom import (ACCENT, FPS, H, W, Text, Tiles, View, _back, _clamp, _credit, _font, _rgb, _sample, _smooth,
                     _vignette, ground_needs, m_per_px, render_ground, world, world_arr)

HERE = Path(__file__).resolve().parent
R_KM = 6371.0088
BLACK_MARBLE = ("https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/"
                "GoogleMapsCompatible_Level8/{z}/{y}/{x}.png")
WAYBACK_CONFIG = "https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json"
WAYBACK_TILEMAP = "https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tilemap/{r}/{z}/{y}/{x}"
CREDITS = {
    "range": "Imagery © Esri, Maxar, Earthstar Geographics",
    "then_now": "Imagery © Esri World Imagery Wayback, Maxar, Earthstar Geographics",
    "night": "Imagery © Esri, Maxar, Earthstar Geographics · Night lights: NASA Earth Observatory, Black Marble 2016",
    "flyover": "Imagery © Esri, Maxar, Earthstar Geographics · Buildings © OpenStreetMap",
}
DUR = {"range": 8.0, "then_now": 8.0, "night": 8.0, "flyover": 10.0}
# from the scene's start to the moment its words should land: the first ring leaving, the place, the nightfall
LEAD = {"range": 1.0, "then_now": 0.6, "night": 1.2, "flyover": 0.5}
MONTHS = {
    "cs": ["leden", "únor", "březen", "duben", "květen", "červen", "červenec", "srpen", "září", "říjen", "listopad", "prosinec"],
    "pl": ["styczeń", "luty", "marzec", "kwiecień", "maj", "czerwiec", "lipiec", "sierpień", "wrzesień", "październik",
           "listopad", "grudzień"],
    "en": ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November",
           "December"],
}


# ── small shared pieces ─────────────────────────────────────────────────────────────────────────────────────
def _lang(lang: str) -> str:
    s = str(lang or "").lower()
    return "cs" if s.startswith(("cz", "cs", "če")) else "pl" if s.startswith(("pl", "po")) else "en"


def _num(n: float, lang: str) -> str:
    """4 500 in Czech and Polish, 4,500 in English."""
    s = f"{int(round(n)):,}"
    return s.replace(",", " ") if _lang(lang) in ("cs", "pl") else s


def _unit(lon, lat) -> np.ndarray:
    lon, lat = np.radians(np.asarray(lon, dtype=np.float64)), np.radians(np.asarray(lat, dtype=np.float64))
    return np.stack([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)], axis=-1)


def _lonlat(v) -> tuple:
    v = np.asarray(v, dtype=np.float64)
    return np.degrees(np.arctan2(v[..., 1], v[..., 0])), np.degrees(np.arcsin(np.clip(v[..., 2], -1, 1)))


def _world_lonlat(wx, wy) -> tuple:
    lon = wx / 256.0 * 360.0 - 180.0
    lat = np.degrees(np.arctan(np.sinh(np.pi * (1.0 - 2.0 * wy / 256.0))))
    return lon, lat


def _slerp(a, b, u: float) -> np.ndarray:
    d = float(np.clip(np.dot(a, b), -1, 1))
    th = math.acos(d)
    if th < 1e-6:
        return a
    return (math.sin((1 - u) * th) * a + math.sin(u * th) * b) / math.sin(th)


def _basis(c) -> tuple:
    """East and north at the unit vector c."""
    lon, lat = _lonlat(c)
    lo, la = math.radians(float(lon)), math.radians(float(lat))
    e = np.array([-math.sin(lo), math.cos(lo), 0.0])
    n = np.array([-math.sin(la) * math.cos(lo), -math.sin(la) * math.sin(lo), math.cos(la)])
    return e, n


def _geocode(p: dict, log=print):
    """(lon, lat) for a place: the designer's coordinates, else OpenStreetMap's first answer."""
    try:
        return float(p["lon"]), float(p["lat"])
    except (KeyError, TypeError, ValueError):
        pass
    for q in [", ".join(x for x in (p.get("name"), p.get("city"), p.get("country")) if x), p.get("name")]:
        if not q:
            continue
        for r in sz._nominatim(q):
            try:
                return float(r["lon"]), float(r["lat"])
            except (KeyError, TypeError, ValueError):
                continue
    log(f"  satfx: could not place {p.get('name')!r}")
    return None


def _chip(layer: Image.Image, x: float, y: float, text: str, k: float, font="Inter-SemiBold.ttf", size=26,
          fg=(255, 255, 255, 255), bg=(10, 12, 16, 190), bar=None, alpha=1.0, anchor="l"):
    """A rounded label on a dark chip; (x, y) is its left-middle (anchor "l") or middle-bottom ("b")."""
    if alpha <= 0.01 or not text:
        return None
    f = _font(font, max(8, int(round(size * k))))
    tw = f.getlength(text)
    bb = f.getbbox("Hg")
    th = bb[3] - bb[1]
    px, py = 11 * k, 7 * k
    wbox, hbox = tw + 2 * px + (5 * k if bar else 0), th + 2 * py
    if anchor == "b":
        x0, y0 = x - wbox / 2, y - hbox
    else:
        x0, y0 = x, y - hbox / 2
    sub = Image.new("RGBA", (int(wbox + 4), int(hbox + 4)), (0, 0, 0, 0))
    d = ImageDraw.Draw(sub)
    d.rounded_rectangle([0, 0, wbox, hbox], radius=6 * k, fill=bg[:3] + (int(bg[3] * alpha),))
    tx = px + (5 * k if bar else 0)
    if bar:
        d.rounded_rectangle([0, 0, 5 * k, hbox], radius=2 * k, fill=tuple(bar[:3]) + (int(255 * alpha),))
    d.text((tx, py - bb[1]), text, font=f, fill=fg[:3] + (int(fg[3] * alpha),))
    layer.alpha_composite(sub, (int(max(0, x0)), int(max(0, y0))))
    return x0, y0, x0 + wbox, y0 + hbox


def _chip_size(text: str, k: float, font="Inter-SemiBold.ttf", size=26) -> tuple:
    f = _font(font, max(8, int(round(size * k))))
    bb = f.getbbox("Hg")
    return f.getlength(text) + 22 * k, bb[3] - bb[1] + 14 * k


def _place(lay: Image.Image, x: float, y: float, text: str, k: float, placed: list, **kw):
    """A chip beside the dot at (x, y) where it covers no other label or dot: right, left, below, above."""
    w_, h_ = _chip_size(text, k, kw.get("font", "Inter-SemiBold.ttf"), kw.get("size", 26))
    gap = 20 * k
    tries = [(x + gap, y), (x - gap - w_, y), (x + 10 * k, y + h_ * 0.95), (x + 10 * k, y - h_ * 0.95),
             (x - w_ - 10 * k, y + h_ * 0.95), (x - w_ - 10 * k, y - h_ * 0.95)]
    def free(bx, by):
        box = (bx - 3 * k, by - h_ / 2 - 3 * k, bx + w_ + 3 * k, by + h_ / 2 + 3 * k)
        inside = box[0] > 8 * k and box[2] < lay.width - 8 * k and box[1] > 8 * k and box[3] < lay.height - 44 * k
        return inside and not any(box[0] < b[2] and b[0] < box[2] and box[1] < b[3] and b[1] < box[3] for b in placed)
    bx, by = next(((a_, b_) for a_, b_ in tries if free(a_, b_)), tries[0])
    placed.append((bx - 3 * k, by - h_ / 2 - 3 * k, bx + w_ + 3 * k, by + h_ / 2 + 3 * k))
    return _chip(lay, bx, by, text, k, **kw)


def _dot(layer: Image.Image, x: float, y: float, k: float, core, scale: float = 1.0, ring=(255, 255, 255),
         glow: float = 0.0):
    """A marker dot, drawn three times larger and shrunk so its edge is smooth."""
    if scale <= 0.02:
        return
    s = 3
    half = int(34 * k) + 2
    sub = Image.new("RGBA", (2 * half * s, 2 * half * s), (0, 0, 0, 0))
    d = ImageDraw.Draw(sub)
    c = half * s
    r_out, r_in = 13 * k * s * scale, 9 * k * s * scale
    if glow > 0:
        for i, a in ((2.6, 40), (1.9, 70)):
            rr = r_out * i
            d.ellipse([c - rr, c - rr, c + rr, c + rr], fill=tuple(core[:3]) + (int(a * glow),))
    d.ellipse([c - r_out - 2 * k * s, c - r_out + 1 * k * s, c + r_out + 2 * k * s, c + r_out + 5 * k * s],
              fill=(0, 0, 0, 90))
    d.ellipse([c - r_out, c - r_out, c + r_out, c + r_out], fill=tuple(ring[:3]) + (255,))
    d.ellipse([c - r_in, c - r_in, c + r_in, c + r_in], fill=tuple(core[:3]) + (255,))
    patch = sub.resize((2 * half, 2 * half), Image.BOX)
    if glow > 0:
        patch = patch.filter(ImageFilter.GaussianBlur(0.6 * k))
    ox, oy = int(x - half), int(y - half)
    if -2 * half < ox < layer.width and -2 * half < oy < layer.height:
        full = Image.new("RGBA", layer.size, (0, 0, 0, 0))
        full.paste(patch, (ox, oy))
        layer.alpha_composite(full)


def _stars(w: int, h: int, seed: int) -> np.ndarray:
    """A quiet star field over a deep blue gradient — the space behind the globe."""
    rng = np.random.default_rng(seed)
    g = np.linspace(0, 1, h, dtype=np.float32)[:, None, None]
    img = (np.array([4, 6, 12], np.float32) * (1 - g) + np.array([10, 16, 30], np.float32) * g) * np.ones((1, w, 1), np.float32)
    n = int(w * h / 2400)
    xs, ys = rng.integers(0, w, n), rng.integers(0, h, n)
    br = rng.random(n) ** 3 * 200 + 25
    star = np.zeros((h, w), np.float32)
    star[ys, xs] = br
    star = np.asarray(Image.fromarray(np.clip(star, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.6)),
                      np.float32) * 1.6
    return np.clip(img + star[..., None] * np.array([0.85, 0.9, 1.0], np.float32), 0, 255)


def _encode(frame_fn, duration: float, out: Path, sounds: list, fps: int = FPS, workers: int = 4, log=print) -> Path:
    out = Path(out)
    n = int(round(duration * fps))
    t0 = time.time()
    tmp = Path(tempfile.mkdtemp(prefix="satfx_"))
    try:
        def one(i):
            frame_fn(i / fps).save(tmp / f"f_{i:05d}.jpg", quality=93)
        with ThreadPoolExecutor(max_workers=max(1, workers)) as ex:
            list(ex.map(one, range(n)))
        out.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(["ffmpeg", "-y", "-framerate", str(fps), "-i", str(tmp / "f_%05d.jpg"),
                        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
                        "-color_range", "tv", "-r", str(fps), str(out)], check=True, capture_output=True)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    out.with_suffix(".sfx.json").write_text(json.dumps([(round(a, 3), s, g) for a, s, g in sounds]), encoding="utf-8")
    log(f"  satfx: {out.name} — {n} frames in {time.time() - t0:.0f}s")
    return out


def _texts(sc: dict, k: float, accent, k0: float, scale: float = 1.0):
    """The kicker and title, typed from k0 — the same lettering as the zoom (smaller with scale < 1)."""
    text = Text(str(sc.get("kicker") or ""), str(sc.get("title") or ""), accent, k, scale)
    nk = len(str(sc.get("kicker") or ""))
    dt = min(0.075, 0.75 / max(1, nk)) if nk else 0.0
    tl = {"kicker": (k0, dt), "title": min(k0 + nk * dt + (0.12 if nk else 0.0), float(sc["duration"]) - 0.9)}
    return text, tl


def _typing_sounds(sc: dict, tl: dict) -> list:
    k0, dt = tl["kicker"]
    return [(round(k0 + i * dt, 3), "typekey", -16.0) for i, ch in enumerate(str(sc.get("kicker") or "")) if ch.strip()] + \
        [(tl["title"], "hit", -7.0)]


def _rings(delta: np.ndarray, alphas: list, accent, k: float, img: np.ndarray, fills=None) -> np.ndarray:
    """Range rings painted by distance: every pixel knows how far it lies from the origin (delta, radians), so a
    ring is exact on a globe or a map, bends round the Earth and hides behind its edge on its own."""
    if not alphas:
        return img
    valid = np.isfinite(delta)
    d = np.nan_to_num(delta, nan=10.0)
    gy, gx = np.gradient(d)
    grad = np.hypot(gx, gy)
    # at the Earth's edge the neighbour is space: no gradient there, so no soft edge either
    grad = np.where(valid & (grad < 0.5), np.maximum(grad, 1e-9), 0.5)
    acc = np.array(accent, np.float32)
    fill = np.zeros(delta.shape, np.float32)
    edge = np.zeros(delta.shape, np.float32)
    order = sorted(range(len(alphas)), key=lambda i: alphas[i])
    for rank, i in enumerate(order):
        a = float(alphas[i])
        if a <= 0:
            continue
        inside = np.clip((a - d) / (grad * 1.2) + 0.5, 0, 1) * valid
        # a radar sweep: brighter just inside the edge, quieter towards the middle
        band = 0.55 + 0.45 * np.exp(-np.clip(a - d, 0, None) / max(0.14 * a, 1e-6))
        f = (fills[i] if fills else (0.36 if rank == 0 else 0.24))
        fill = np.maximum(fill, inside * band * f)
        edge = np.maximum(edge, np.clip(1 - np.abs(d - a) / (grad * 2.5 * k), 0, 1) * valid)
    glow = np.asarray(Image.fromarray((edge * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(9 * k)),
                      np.float32) / 255.0
    out = img * (1 - fill[..., None]) + acc * fill[..., None]
    out = out + acc * (glow[..., None] * 0.75)
    bright = np.minimum(acc * 1.15 + 30, 255)
    out = out * (1 - edge[..., None]) + bright * edge[..., None]
    return np.clip(out, 0, 255)


# ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
# RANGE
# ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
def range_scene(origin: dict, km: list, targets: list = (), title: str = "", kicker: str = "", duration: float = None,
                hit: float = None, accent: str = ACCENT, lang: str = "", log=print):
    """A range scene (a JSON-able dict), or None when the origin cannot be placed."""
    o = _geocode(origin, log)
    if not o:
        return None
    rings = sorted({float(x) for x in km if float(x) > 0})[:3]
    if not rings:
        return None
    tg = []
    for t in list(targets or [])[:6]:
        ll = _geocode(t, log)
        if ll:
            d = float(np.degrees(np.arccos(np.clip(np.dot(_unit(*o), _unit(*ll)), -1, 1)))) * math.pi / 180 * R_KM
            tg.append({"label": str(t.get("label") or t.get("name") or ""), "lon": ll[0], "lat": ll[1], "km": round(d, 1),
                       "arc": bool(t.get("arc"))})
    return {"shot": "range", "origin": {"label": str(origin.get("label") or origin.get("name") or ""),
                                       "lon": o[0], "lat": o[1]},
            "rings": rings, "targets": tg, "mode": "globe" if max(rings) >= 1200 else "flat",
            "title": str(title or ""), "kicker": str(kicker or ""), "accent": accent, "lang": _lang(lang),
            "duration": float(duration or DUR["range"]), "hit": float(LEAD["range"] if hit is None else hit)}


class RangeShot:
    def __init__(self, sc: dict, size=(W, H)):
        self.sc, (self.w, self.h) = sc, size
        self.k = self.h / H
        self.accent = _rgb(sc.get("accent"))
        self.tiles = Tiles()
        self.o = _unit(sc["origin"]["lon"], sc["origin"]["lat"])
        self.km = list(sc["rings"])
        self.alpha = [x / R_KM for x in self.km]
        hit, dur = float(sc["hit"]), float(sc["duration"])
        # ring i leaves 0.9 s after the one before and spreads for 2.2 s; the camera pulls back while they do
        # sc['ring_dur'] (optional): a slower spread, so a target lights on the word that names it
        rd = float(sc.get("ring_dur") or 2.2)
        self.ring_t = [(hit + 0.9 * i, hit + 0.9 * i + rd) for i in range(len(self.km))]
        self.pull = (hit - 0.3, self.ring_t[-1][1] + 0.3)
        self.text, self.tl = _texts(sc, self.k, self.accent, float(sc.get("title_at") or 0.55), scale=0.62)
        self.targets = []
        for t in sc.get("targets") or []:
            u = _unit(t["lon"], t["lat"])
            a = math.acos(float(np.clip(np.dot(self.o, u), -1, 1)))
            self.targets.append(dict(t, u=u, a=a))
        self.globe = sc.get("mode") == "globe"
        self.vig = _vignette(self.w, self.h)
        if self.globe:
            self._plan_globe()
            self.space = _stars(self.w, self.h, int(abs(sc["origin"]["lon"] * 1000)) % 99991)
        else:
            self._plan_flat()

    # the rings grow fast and settle: an ease-out
    def _grow(self, i: int, t: float) -> float:
        a, b = self.ring_t[i]
        u = _clamp((t - a) / (b - a))
        return 1 - (1 - u) ** 2.4

    # ── globe ─────────────────────────────────────────────────────────────────────────────────────────────
    def _plan_globe(self):
        # the biggest ring sits centred in the room under the title, the origin in its middle
        top = self.text.bottom / self.k + 44
        bottom = H - 44
        self.cy = (top + bottom) / 2
        half = (bottom - top) / 2
        big = min(self.alpha[-1], math.pi / 2)
        s_ = max(math.sin(big), 1e-3)
        R = min(1150.0, 0.97 * half / s_, 0.46 * W / s_)
        for tg in self.targets:                        # a target past the rings still has to be in the frame
            if tg["a"] < math.pi / 2:
                R = min(R, 0.9 * half / max(math.sin(tg["a"]), 1e-3))
        self.R_end = max(0.9 * half, R) if self.alpha[-1] > math.pi / 2 else max(220.0, R)
        self.R_start = min(self.R_end * 2.8, 5200.0)
        self.c_start = self.c_end = self.o

    def _globe_cam(self, t: float):
        u = _smooth((t - self.pull[0]) / (self.pull[1] - self.pull[0]))
        R = self.R_start * (self.R_end / self.R_start) ** u        # a zoom out even in log terms
        c = _slerp(self.c_start, self.c_end, u)
        # a slow turn of the Earth under the camera
        spin = math.radians(1.6 * t / max(1.0, float(self.sc["duration"])))
        rot = np.array([[math.cos(spin), -math.sin(spin), 0], [math.sin(spin), math.cos(spin), 0], [0, 0, 1]])
        c = rot @ c
        e, n = _basis(c)
        return R, c, e, n

    def _globe_frame(self, t: float) -> np.ndarray:
        k, w, h = self.k, self.w, self.h
        R, c, e, n = self._globe_cam(t)
        xs = ((np.arange(w) + 0.5) / k - W / 2) / R
        ys = (self.cy - (np.arange(h) + 0.5) / k) / R
        X, Y = np.meshgrid(xs, ys)
        r2 = X * X + Y * Y
        inside = r2 <= 1.0
        img = self.space.copy()
        idx = np.nonzero(inside)
        Xi, Yi = X[idx], Y[idx]
        Zi = np.sqrt(np.clip(1 - Xi * Xi - Yi * Yi, 0, 1))
        P = Xi[:, None] * e + Yi[:, None] * n + Zi[:, None] * c
        lon, lat = _lonlat(P)
        wxy = world_arr(np.stack([lon, lat], axis=1))
        # each pixel reads the tile level that matches its size: the limb and the high latitudes need less
        L = math.log2(2 * math.pi * R * k / 256.0)
        lvl = L - 0.5 * np.log2(1 / np.maximum(Zi, 0.04)) - np.log2(1 / np.maximum(np.cos(np.radians(lat)), 0.05))
        lvl = np.clip(lvl, 1.0, 8.999)
        col = np.zeros((len(Xi), 3), np.float32)
        l0 = np.floor(lvl).astype(int)
        lon_c, lat_c = _lonlat(c)
        cxw = world(float(lon_c), float(lat_c))[0]
        for lv in np.unique(l0):
            m = l0 == lv
            a = _sample(self.tiles, int(lv), wxy[m, 0], wxy[m, 1], cxw)
            f = (lvl[m] - lv).astype(np.float32)[:, None]
            if lv < 9 and float(f.max()) > 0.02:
                b = _sample(self.tiles, int(lv) + 1, wxy[m, 0], wxy[m, 1], cxw)
                a = a + (b - a) * f
            col[m] = a
        # light from the upper left, a darker limb, a blue rim of atmosphere
        sun = -0.36 * e + 0.46 * n + 0.81 * c
        sun = sun / np.linalg.norm(sun)
        lam = np.clip(P @ sun, 0, 1)
        shade = (0.34 + 0.66 * lam ** 0.8) * (0.62 + 0.38 * Zi)
        col = col * shade[:, None]
        rim = ((1 - Zi) ** 2.4)[:, None]
        col = col * (1 - 0.45 * rim) + np.array([90, 150, 255], np.float32) * rim * 0.45
        img[idx] = col
        # the atmosphere's glow round the Earth
        rr = np.sqrt(r2)
        halo = np.exp(-np.clip(rr - 1, 0, None) * R / (26 * 1.0)) * (rr > 1)
        img = img + np.array([70, 130, 255], np.float32) * (halo[..., None] * 0.55)
        # distance from the origin for every pixel on the Earth
        delta = np.full((h, w), np.nan)
        delta[idx] = np.arccos(np.clip(P @ self.o, -1, 1))
        alphas = [self.alpha[i] * self._grow(i, t) for i in range(len(self.alpha))]
        img = _rings(delta, alphas, self.accent, k, img)
        self._proj = lambda q: (float(np.dot(q, e)), float(np.dot(q, n)), float(np.dot(q, c)), R)
        return img

    def _globe_xy(self, q):
        x, y, z, R = self._proj(q)
        return (W / 2 + R * x) * self.k, (self.cy - R * y) * self.k, z > 0.02

    # ── flat: the satellite map, for a reach under ~1200 km ───────────────────────────────────────────────
    def _plan_flat(self):
        lat = float(self.sc["origin"]["lat"])
        r = self.km[-1] * 1000.0
        self.z_end = math.log2(156543.03392 * math.cos(math.radians(lat)) * 0.34 * H / r)
        self.z_start = self.z_end + 1.4
        self.flat_target = world(self.sc["origin"]["lon"], lat)

    def _flat_frame(self, t: float) -> np.ndarray:
        u = _smooth((t - self.pull[0]) / (self.pull[1] - self.pull[0]))
        z = self.z_start + (self.z_end - self.z_start) * u
        cam = {"z": z, "pitch": math.radians(24.0), "bearing": math.radians(-3.0 * t / float(self.sc["duration"])),
               "dz": 0.0, "target": self.flat_target}
        view = View(cam)
        g, wx, wy = render_ground(view, self.tiles, self.w, self.h, self.k, want_xy=True)
        lon, lat = _world_lonlat(wx, wy)
        P = _unit(lon, lat)
        delta = np.arccos(np.clip(P @ self.o, -1, 1))
        alphas = [self.alpha[i] * self._grow(i, t) for i in range(len(self.alpha))]
        g = _rings(delta, alphas, self.accent, self.k, g)
        self._view = view
        return g

    def _flat_xy(self, q):
        lon, lat = _lonlat(q)
        wx, wy = world(float(lon), float(lat))
        uu, vv, _, _, _ = self._view.project(np.array([wx]), np.array([wy]))
        return (float(uu[0]) + W / 2) * self.k, (float(vv[0]) + H / 2) * self.k, True

    # ── one frame ─────────────────────────────────────────────────────────────────────────────────────────
    def frame(self, t: float) -> Image.Image:
        k = self.k
        g = self._globe_frame(t) if self.globe else self._flat_frame(t)
        xy = self._globe_xy if self.globe else self._flat_xy
        g = g * self.vig
        img = Image.fromarray(np.clip(g, 0, 255).astype(np.uint8), "RGB").convert("RGBA")
        lay = Image.new("RGBA", img.size, (0, 0, 0, 0))
        lang = self.sc.get("lang", "en")
        placed = []
        # the origin: a pulse, a dot and its name
        ox, oy, ovis = xy(self.o)
        if ovis:
            pop = _back((t - 0.25) / 0.35)
            for ph in (0.0, 0.5):
                q = ((t + ph * 1.4) % 1.4) / 1.4
                rr = (14 + 46 * q) * k
                a = int(150 * (1 - q) * _clamp(t / 0.5))
                ImageDraw.Draw(lay).ellipse([ox - rr, oy - rr, ox + rr, oy + rr], outline=self.accent + (a,),
                                            width=max(1, int(2 * k)))
            _dot(lay, ox, oy, k, self.accent, pop, glow=0.6)
            placed.append((ox - 16 * k, oy - 16 * k, ox + 16 * k, oy + 16 * k))
            _place(lay, ox, oy, self.sc["origin"]["label"], k, placed, font="Inter-ExtraBold.ttf", size=27,
                   fg=(10, 10, 10, 255), bg=self.accent + (235,), alpha=_smooth((t - 0.45) / 0.3))
        # the targets light up as a ring reaches them
        for tg in self.targets:
            reach = max((self.alpha[i] * self._grow(i, t) for i in range(len(self.alpha))), default=0)
            if reach < tg["a"]:
                continue
            when = next((self.ring_t[i][0] + (self.ring_t[i][1] - self.ring_t[i][0]) *
                         (1 - (1 - min(1.0, tg["a"] / self.alpha[i])) ** (1 / 2.4))
                         for i in range(len(self.alpha)) if self.alpha[i] >= tg["a"]), t)
            tx, ty, vis = xy(tg["u"])
            if not vis:
                continue
            a = _smooth((t - when) / 0.25)
            _dot(lay, tx, ty, k, (255, 255, 255), _back((t - when) / 0.3) * 0.85, ring=self.accent, glow=0.4)
            placed.append((tx - 12 * k, ty - 12 * k, tx + 12 * k, ty + 12 * k))
            _place(lay, tx, ty, tg["label"], k, placed, size=25, alpha=a)
        # a flight path to a target marked "arc": a lifted great-circle arc, drawn from the origin with a glowing
        # head, once the ring has reached the target
        for tg in [x for x in self.targets if x.get("arc")]:
            i = next((j for j in range(len(self.alpha)) if self.alpha[j] >= tg["a"]), None)
            if i is None:
                continue
            a0, b0 = self.ring_t[i]
            t_hit = a0 + (b0 - a0) * (1 - (1 - min(1.0, tg["a"] / self.alpha[i])) ** (1 / 2.4))
            fly = _clamp((t - t_hit - 0.15) / 1.3)
            if fly <= 0:
                continue
            fly = 1 - (1 - fly) ** 1.6
            # the path follows the great circle on the ground, bowed upwards on screen like a flight on a map
            n_seg = 64
            x0_, y0_, v0 = xy(self.o)
            x1_, y1_, v1 = xy(tg["u"])
            dx_, dy_ = x1_ - x0_, y1_ - y0_
            chord = math.hypot(dx_, dy_) or 1.0
            nx_, ny_ = -dy_ / chord, dx_ / chord
            if ny_ > 0:
                nx_, ny_ = -nx_, -ny_                          # the bow goes up the screen
            pts = []
            for j in range(int(n_seg * fly) + 1):
                u = j / n_seg
                x, y, vis = xy(_slerp(self.o, tg["u"], u))
                if not vis:
                    break                                     # behind the Earth
                bow = 0.26 * chord * math.sin(math.pi * u)
                pts.append((x + nx_ * bow, y + ny_ * bow))
            if len(pts) > 1:
                glow = Image.new("L", img.size, 0)
                ImageDraw.Draw(glow).line(pts, fill=255, width=max(3, int(14 * k)), joint="curve")
                gl = Image.new("RGBA", img.size, self.accent + (0,))
                gl.putalpha(glow.filter(ImageFilter.GaussianBlur(9 * k)).point(lambda v_: int(v_ * 0.85)))
                lay.alpha_composite(gl)
                ImageDraw.Draw(lay).line(pts, fill=(255, 250, 225, 255), width=max(2, int(round(3.6 * k))), joint="curve")
                if fly < 1:
                    hx, hy = pts[-1]
                    _dot(lay, hx, hy, k, (255, 255, 240), 0.7, ring=self.accent, glow=1.0)
        # each ring's distance, counted up as it grows, riding on its highest visible point
        for i, (km, al) in enumerate(zip(self.km, self.alpha)):
            gr = self._grow(i, t)
            if gr <= 0:
                continue
            e_o, n_o = _basis(self.o)
            best = None
            for b in np.radians(np.arange(-60, 61, 10)):
                q = math.cos(al * gr) * self.o + math.sin(al * gr) * (math.cos(b) * n_o + math.sin(b) * e_o)
                x, y, vis = xy(q)
                if vis and 0 < x < self.w and self.text.bottom + 60 * k < y < self.h - 40 * k and \
                        (best is None or y < best[1]):
                    best = (x, y)
            if best:
                _chip(lay, best[0], best[1] - 10 * k, f"{_num(km * gr, lang)} km", k, font="Anton-Regular.ttf", size=36,
                      fg=self.accent + (255,), bg=(8, 10, 14, 200), alpha=_smooth(gr / 0.12), anchor="b")
        img.alpha_composite(lay)
        self.text.draw(img, t, self.tl)
        _credit(img, k, CREDITS["range"])
        return img.convert("RGB")

    def prefetch(self, fps: int = FPS, log=print):
        need = set()
        n = int(round(float(self.sc["duration"]) * fps))
        for i in range(0, n, 3):
            t = i / fps
            if self.globe:
                R, c, e, nn = self._globe_cam(t)
                L = math.log2(2 * math.pi * R * self.k / 256.0)
                # a coarse grid over the disc, at the two levels each point reads
                for X in np.linspace(-0.98, 0.98, 25):
                    for Y in np.linspace(-0.98, 0.98, 25):
                        sx, sy = W / 2 + R * X, self.cy - R * Y
                        if X * X + Y * Y > 1 or not (-50 < sx < W + 50 and -50 < sy < H + 50):
                            continue
                        Z = math.sqrt(max(0.0, 1 - X * X - Y * Y))
                        P = X * e + Y * nn + Z * c
                        lon, lat = _lonlat(P)
                        lv = L - 0.5 * math.log2(1 / max(Z, 0.04)) - math.log2(1 / max(math.cos(math.radians(float(lat))), 0.05))
                        l0 = int(min(8, max(1, math.floor(lv))))
                        wx, wy = world(float(lon), float(lat))
                        for lz in (l0, l0 + 1):
                            m = 1 << lz
                            need.add((lz, int(wx / 256 * m) % m, min(m - 1, max(0, int(wy / 256 * m)))))
            else:
                u = _smooth((t - self.pull[0]) / (self.pull[1] - self.pull[0]))
                z = self.z_start + (self.z_end - self.z_start) * u
                view = View({"z": z, "pitch": math.radians(24.0), "bearing": 0.0, "dz": 0.0, "target": self.flat_target})
                need |= ground_needs(view, self.w, self.h, self.k)
        more = set()
        for (z, x, y) in need:
            while z > 0:
                z, x, y = z - 1, x // 2, y // 2
                if (z, x, y) in need or (z, x, y) in more:
                    break
                more.add((z, x, y))
        self.tiles.fetch(sorted(need | more), log=log)

    def sounds(self) -> list:
        out = [(0.25, "pop", -8.0)]
        for i, (a, b) in enumerate(self.ring_t):
            out += [(a, "whoosh", -7.0 - 2 * i), (b - 0.2, "hum", -16.0)]
        for tg in self.targets:
            for i, al in enumerate(self.alpha):
                if al >= tg["a"]:
                    a, b = self.ring_t[i]
                    out.append((round(a + (b - a) * (1 - (1 - min(1.0, tg["a"] / al)) ** (1 / 2.4)), 3), "ping", -10.0))
                    break
        out += _typing_sounds(self.sc, self.tl) + [(float(self.sc["duration"]), "whoosh_out", -11.0)]
        return out


# ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
# THEN / NOW
# ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
def _wayback_releases() -> list:
    """[(release number, 'YYYY-MM-DD', tile url, metadata url)] oldest first — Esri's archive of World Imagery."""
    import requests

    def fetch():
        r = requests.get(WAYBACK_CONFIG, headers=sz.UA, timeout=40)
        return r.json() if r.status_code == 200 else None
    f = sz.CACHE / "wayback" / "config.json"
    data = None
    if f.exists() and time.time() - f.stat().st_mtime < 86400:
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
        except ValueError:
            data = None
    if data is None:
        data = fetch()
        if data:
            f.parent.mkdir(parents=True, exist_ok=True)
            f.write_text(json.dumps(data), encoding="utf-8")
    out = []
    for key, v in (data or {}).items():
        m = re.search(r"(\d{4}-\d{2}-\d{2})", str(v.get("itemTitle") or ""))
        if m and v.get("itemURL"):
            url = v["itemURL"].replace("{level}", "{z}").replace("{row}", "{y}").replace("{col}", "{x}")
            out.append((int(key), m.group(1), url, v.get("metadataLayerUrl") or ""))
    return sorted(out, key=lambda r: r[1])


def _wayback_source(release: int, z: int, x: int, y: int) -> int:
    """The release whose imagery a tile of `release` really shows (Esri keeps unchanged tiles from older ones)."""
    import requests

    def fetch():
        try:
            r = requests.get(WAYBACK_TILEMAP.format(r=release, z=z, y=y, x=x), headers=sz.UA, timeout=30)
            return r.json() if r.status_code == 200 else None
        except Exception:                                  # noqa: BLE001
            return None
    d = sz._cached("wayback", f"tilemap|{release}|{z}|{x}|{y}", fetch) or {}
    return int((d.get("select") or [release])[0])


def _wayback_date(meta_url: str, lon: float, lat: float) -> str:
    """The imagery's capture date at a point ('YYYYMMDD'), from the release's metadata layers, or ''."""
    import requests
    if not meta_url:
        return ""

    def fetch():
        for lid in (4, 5, 6, 3, 7, 8):
            try:
                r = requests.get(f"{meta_url}/{lid}/query", headers=sz.UA, timeout=30, params={
                    "f": "json", "where": "1=1", "outFields": "SRC_DATE,SRC_DATE2,NICE_DESC", "geometry": f"{lon},{lat}",
                    "geometryType": "esriGeometryPoint", "inSR": 4326, "spatialRel": "esriSpatialRelIntersects",
                    "returnGeometry": "false"})
                feats = (r.json() or {}).get("features") or []
            except Exception:                              # noqa: BLE001
                feats = []
            for f in feats:
                d = str((f.get("attributes") or {}).get("SRC_DATE") or "")
                if re.fullmatch(r"\d{8}", d):
                    return {"date": d}
        return {"date": ""}
    return str((sz._cached("wayback", f"date|{meta_url}|{lon:.5f}|{lat:.5f}", fetch) or {}).get("date") or "")


def then_now_scene(place: dict, then: int, now: int = None, title: str = "", kicker: str = "", duration: float = None,
                   hit: float = None, accent: str = ACCENT, lang: str = "", log=print):
    """A then-and-now scene, or None when the archive shows no different picture of the place."""
    found = sz.find(place, log=log, buildings=False)
    if not found:
        return None
    rel = _wayback_releases()
    if not rel:
        log("  satfx: the Esri Wayback archive did not answer")
        return None
    pin = found.get("pin") or [found["lon"], found["lat"]]
    z = 16
    wx, wy = world(*pin)
    tx, ty = int(wx / 256 * (1 << z)), int(wy / 256 * (1 << z))
    by_num = {r[0]: r for r in rel}
    order = [r[0] for r in rel]
    newest = [r for r in rel if not now or r[1] <= f"{int(now)}-12-31"][-1]
    then_pick = ([r for r in rel if r[1] <= f"{int(then)}-12-31"] or [rel[0]])[-1]
    src_now = _wayback_source(newest[0], z, tx, ty)
    src_then = _wayback_source(then_pick[0], z, tx, ty)
    if src_then == src_now:
        src_then = _wayback_source(rel[0][0], z, tx, ty)          # the oldest the archive has
    if src_then == src_now or src_then not in by_num or src_now not in by_num:
        log(f"  satfx: the archive has one picture of {place.get('name')!r} — no then and now")
        return None
    d_then = _wayback_date(by_num[src_then][3], *pin) or by_num[src_then][1].replace("-", "")
    d_now = _wayback_date(by_num[src_now][3], *pin) or by_num[src_now][1].replace("-", "")
    if d_then[:4] == d_now[:4]:
        log(f"  satfx: both pictures of {place.get('name')!r} are from {d_now[:4]} — no then and now")
        return None
    return {"shot": "then_now", "lon": float(pin[0]), "lat": float(pin[1]), "z1": float(found["z1"]),
            "outline": found.get("outline"),
            "then": {"url": by_num[src_then][2], "date": d_then}, "now": {"url": by_num[src_now][2], "date": d_now},
            "title": str(title or ""), "kicker": str(kicker or ""), "accent": accent, "lang": _lang(lang),
            "duration": float(duration or DUR["then_now"]), "hit": float(LEAD["then_now"] if hit is None else hit)}


class ThenNowShot:
    def __init__(self, sc: dict, size=(W, H)):
        self.sc, (self.w, self.h) = sc, size
        self.k = self.h / H
        self.accent = _rgb(sc.get("accent"))
        self.old, self.new = Tiles(sc["then"]["url"]), Tiles(sc["now"]["url"])
        self.target = world(sc["lon"], sc["lat"])
        # wider than a zoom's end: a change reads across a block, not on one roof
        self.z = min(float(sc["z1"]) - 0.35, 16.6)
        self.outline = world_arr(sc["outline"]) if sc.get("outline") else None
        self.vig = _vignette(self.w, self.h)
        dur = float(sc["duration"])
        h0 = float(sc["hit"])
        # held on then; the line sweeps from the right, turning it into now; now holds; the line comes back
        # to the middle and stays: then on the left, now on the right
        sw = float(sc.get("sweep_at") or (h0 + 1.7))          # sc['sweep_at'] (optional): the wipe on the words
        self.sweep = (sw, sw + 1.3)
        self.back = (min(dur - 2.0, sw + 2.7), min(dur - 1.2, sw + 3.6))
        self.text, self.tl = _texts(sc, self.k, self.accent, h0 - 0.1)
        lang = sc.get("lang", "en")

        def label(d):
            y, m = int(d[:4]), int(d[4:6] or 1)
            return str(y), f"{MONTHS[lang][max(1, min(12, m)) - 1]} {y}"
        self.then_lbl, self.now_lbl = label(sc["then"]["date"]), label(sc["now"]["date"])

    def _line_x(self, t: float) -> float:
        """Where the wipe line stands, in 1080p units; right of it is now."""
        a, b = self.sweep
        c, d = self.back
        if t < a:
            return W + 60
        if t < b:
            return W + 60 - (W + 120) * _smooth((t - a) / (b - a))
        if t < c:
            return -60
        return -60 + (W / 2 + 60) * (1 - (1 - _clamp((t - c) / (d - c))) ** 3)

    def _view(self, t: float) -> View:
        dur = float(self.sc["duration"])
        return View({"z": self.z + 0.28 * t / dur, "pitch": math.radians(40.0 + 8.0 * t / dur),
                     "bearing": math.radians(-9.0 + 18.0 * t / dur), "dz": 0.0, "target": self.target})

    def frame(self, t: float) -> Image.Image:
        k = self.k
        view = self._view(t)
        lx = self._line_x(t)
        need_old, need_new = lx > 0, lx < W
        cols = (np.arange(self.w) + 0.5) / k
        if need_old:
            old = render_ground(view, self.old, self.w, self.h, k)
            gray = old[..., 0:1] * 0.299 + old[..., 1:2] * 0.587 + old[..., 2:3] * 0.114
            old = (gray + (old - gray) * 0.78) * 0.97          # the archive a little paler
        if need_new:
            new = render_ground(view, self.new, self.w, self.h, k)
        if need_old and need_new:
            m = np.clip((cols - lx) / 1.5 + 0.5, 0, 1)[None, :, None]
            g = old * (1 - m) + new * m
        else:
            g = old if need_old else new
        g = g * self.vig
        img = Image.fromarray(np.clip(g, 0, 255).astype(np.uint8), "RGB").convert("RGBA")
        lay = Image.new("RGBA", img.size, (0, 0, 0, 0))
        d = ImageDraw.Draw(lay)
        acc = self.accent
        if self.outline is not None:
            u, v, _, _, _ = view.project(self.outline[:, 0], self.outline[:, 1])
            pts = list(zip(((u + W / 2) * k).tolist(), ((v + H / 2) * k).tolist()))
            d.line(pts + pts[:1], fill=acc + (230,), width=max(2, int(round(3 * k))), joint="curve")
        # the line of light, with a handle, like a before/after slider
        if 0 < lx < W:
            x = lx * k
            glow = Image.new("L", img.size, 0)
            ImageDraw.Draw(glow).rectangle([x - 5 * k, 0, x + 5 * k, self.h], fill=255)
            glow = glow.filter(ImageFilter.GaussianBlur(14 * k))
            gl = Image.new("RGBA", img.size, acc + (0,))
            gl.putalpha(glow.point(lambda p: int(p * 0.8)))
            lay.alpha_composite(gl)
            d = ImageDraw.Draw(lay)
            d.rectangle([x - 1.6 * k, 0, x + 1.6 * k, self.h], fill=(255, 255, 255, 255))
            cy, r = self.h * 0.58, 26 * k
            d.ellipse([x - r, cy - r, x + r, cy + r], fill=(255, 255, 255, 255), outline=acc + (255,), width=int(4 * k))
            for sgn in (-1, 1):
                tx = x + sgn * 9 * k
                d.polygon([(tx + sgn * 7 * k, cy), (tx, cy - 7 * k), (tx, cy + 7 * k)], fill=(20, 20, 20, 255))
        # the years: then on the left, now on the right, each where its picture is
        f_big, f_small = _font("Anton-Regular.ttf", int(118 * k)), _font("Inter-SemiBold.ttf", int(25 * k))
        then_a = _smooth((t - float(self.sc["hit"]) + 0.2) / 0.4) * _clamp((lx * k - 420 * k) / (160 * k))
        now_a = _clamp((W - lx) / 260.0) if lx < W else 0.0
        for (big, small), a, left in ((self.then_lbl, then_a, True), (self.now_lbl, now_a, False)):
            if a <= 0.01:
                continue
            bw = f_big.getlength(big)
            x0 = 60 * k if left else self.w - 60 * k - bw
            yb = self.h - 214 * k
            sub = Image.new("RGBA", img.size, (0, 0, 0, 0))
            sd = ImageDraw.Draw(sub)
            sd.text((x0 + 3 * k, yb + 4 * k), big, font=f_big, fill=(0, 0, 0, int(120 * a)))
            sd.text((x0, yb), big, font=f_big, fill=(acc if not left else (255, 255, 255)) + (int(255 * a),))
            sw = f_small.getlength(small)
            sx = x0 if left else self.w - 60 * k - sw
            sd.text((sx + 1, yb + 132 * k + 1), small, font=f_small, fill=(0, 0, 0, int(140 * a)))
            sd.text((sx, yb + 132 * k), small, font=f_small, fill=(255, 255, 255, int(220 * a)))
            lay.alpha_composite(sub)
        img.alpha_composite(lay)
        self.text.draw(img, t, self.tl)
        _credit(img, k, CREDITS["then_now"])
        return img.convert("RGB")

    def prefetch(self, fps: int = FPS, log=print):
        need = set()
        n = int(round(float(self.sc["duration"]) * fps))
        for i in range(0, n, 3):
            need |= ground_needs(self._view(i / fps), self.w, self.h, self.k)
        more = set()
        for (z, x, y) in need:
            while z > 0:
                z, x, y = z - 1, x // 2, y // 2
                if (z, x, y) in need or (z, x, y) in more:
                    break
                more.add((z, x, y))
        for tiles in (self.old, self.new):
            tiles.fetch(sorted(need | more), log=log)

    def sounds(self) -> list:
        a, b = self.sweep
        c, _ = self.back
        out = [(a - 0.05, "whoosh", -7.0)] + [(round(a + (b - a) * i / 6, 3), "tap", -15.0) for i in range(1, 6)]
        out += [(b, "hit", -8.0), (c, "whoosh", -12.0)]
        return out + _typing_sounds(self.sc, self.tl) + [(float(self.sc["duration"]), "whoosh_out", -11.0)]


# ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
# NIGHT
# ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
def night_scene(place: dict, labels: list = (), borders: list = (), span_km: float = None, title: str = "",
                kicker: str = "", duration: float = None, hit: float = None, accent: str = ACCENT, lang: str = "",
                log=print):
    """A nightfall over a region, or None when it cannot be placed."""
    import maps
    c = _geocode(place, log)
    code = maps.country_code(place.get("country") or place.get("name")) if str(place.get("type") or "") == "country" else ""
    span = float(span_km or 0)
    if code:
        rec = next((r for r in maps.gazetteer()["countries"] if r.get("id") == code), None)
        if rec and rec.get("bbox"):
            x0, y0, x1, y1 = rec["bbox"]
            c = c or ((x0 + x1) / 2, (y0 + y1) / 2)
            # the frame is wide and the title takes its top: a tall country needs a wider view to fit
            wk = (x1 - x0) * 111.32 * math.cos(math.radians((y0 + y1) / 2))
            span = span or max(wk * 1.3, (y1 - y0) * 110.5 * 2.3)
    # the countries whose borders are drawn are the story: all of them in the frame, whatever width was asked
    boxes = [r.get("bbox") for r in maps.gazetteer()["countries"]
             if r.get("id") in {maps.country_code(b) for b in (borders or [])} and r.get("bbox")]
    if boxes:
        x0, y0 = min(b[0] for b in boxes), min(b[1] for b in boxes)
        x1, y1 = max(b[2] for b in boxes), max(b[3] for b in boxes)
        c = ((x0 + x1) / 2, (y0 + y1) / 2)
        wk = (x1 - x0) * 111.32 * math.cos(math.radians((y0 + y1) / 2))
        span = max(span, wk * 1.3, (y1 - y0) * 110.5 * 1.45)
    if not c:
        return None
    span = max(250.0, min(span or 800.0, 3500.0))       # the lights are 500 m pixels: a region, never a street
    lb = []
    for p in list(labels or [])[:6]:
        ll = _geocode(p, log)
        if ll:
            lb.append({"label": str(p.get("label") or p.get("name") or ""), "lon": ll[0], "lat": ll[1]})
    rings = []
    for name in list(borders or [])[:4]:
        cc = maps.country_code(name)
        if not cc:
            continue
        for poly in maps._polygons(maps._load("geo_mid"), "countries", cc):
            if poly and len(poly[0]) > 8:
                rings.append([[round(a, 4), round(b, 4)] for a, b in poly[0]])
    return {"shot": "night", "lon": float(c[0]), "lat": float(c[1]), "span_km": round(span, 1), "labels": lb,
            "borders": rings, "title": str(title or ""), "kicker": str(kicker or ""), "accent": accent,
            "lang": _lang(lang), "duration": float(duration or DUR["night"]),
            "hit": float(LEAD["night"] if hit is None else hit)}


class NightShot:
    def __init__(self, sc: dict, size=(W, H)):
        self.sc, (self.w, self.h) = sc, size
        self.k = self.h / H
        self.accent = _rgb(sc.get("accent"))
        self.day, self.night = Tiles(), Tiles(BLACK_MARBLE, max_z=8)
        lat = float(sc["lat"])
        self.target = world(sc["lon"], lat)
        self.z = math.log2(156543.03392 * math.cos(math.radians(lat)) * W / (float(sc["span_km"]) * 1000.0))
        h0 = float(sc["hit"])
        self.fall = (h0, h0 + 2.2)                          # the shadow line crosses the frame
        self.draw_b = (h0 + 2.1, h0 + 3.0)                  # the borders draw in
        self.lab_t = h0 + 2.5
        self.text, self.tl = _texts(sc, self.k, self.accent, h0 + 2.9)
        self.borders = [world_arr(r) for r in sc.get("borders") or []]
        self.vig = _vignette(self.w, self.h)
        y, x = np.mgrid[0:self.h, 0:self.w].astype(np.float32)
        self.slant = (x / self.k) + 0.28 * (y / self.k - H / 2)        # the shadow line leans a little

    def _view(self, t: float) -> View:
        dur = float(self.sc["duration"])
        return View({"z": self.z + 0.22 * t / dur, "pitch": math.radians(30.0 + 6.0 * t / dur),
                     "bearing": math.radians(-4.0 * t / dur), "dz": 0.0, "target": self.target,
                     "pin": (W / 2, H / 2 + 110)})

    def frame(self, t: float) -> Image.Image:
        k = self.k
        view = self._view(t)
        a, b = self.fall
        band = 260.0
        xt = (W + band * 2) - (W + band * 4) * _smooth((t - a) / (b - a))
        dist = self.slant - xt                               # >0: east of the shadow line — already night
        nightw = np.clip(0.5 + dist / (2 * band), 0, 1) if a <= t else np.zeros_like(dist)
        need_day, need_night = float(nightw.min()) < 0.999, float(nightw.max()) > 0.001
        if need_day:
            day = render_ground(view, self.day, self.w, self.h, k)
        if need_night:
            nt = render_ground(view, self.night, self.w, self.h, k)
            lum = nt[..., 0] * 0.3 + nt[..., 1] * 0.59 + nt[..., 2] * 0.11
            lights = np.clip((lum - 40.0) / 150.0, 0, 1)[..., None] * nt
            li = Image.fromarray(np.clip(lights, 0, 255).astype(np.uint8))
            bloom = np.asarray(li.filter(ImageFilter.GaussianBlur(5 * k)), np.float32) * 0.9 + \
                np.asarray(li.filter(ImageFilter.GaussianBlur(18 * k)), np.float32) * 0.7
            warm = np.array([1.05, 0.93, 0.78], np.float32)
            night = nt * 0.85 + (bloom + lights * 0.35) * warm
            night = np.clip(night, 0, 255)
        if need_day and need_night:
            nw = nightw[..., None]
            dusk = np.exp(-(dist / (band * 0.55)) ** 2)[..., None]
            g = day * (1 - nw) + night * nw
            g = g + np.array([255, 120, 50], np.float32) * dusk * 0.32 * (1 - nw * 0.6)
        else:
            g = day if need_day else night
        g = g * self.vig
        img = Image.fromarray(np.clip(g, 0, 255).astype(np.uint8), "RGB").convert("RGBA")
        lay = Image.new("RGBA", img.size, (0, 0, 0, 0))
        # the borders draw in after dark
        c0, c1 = self.draw_b
        f = _smooth((t - c0) / (c1 - c0))
        if f > 0:
            glow = Image.new("L", img.size, 0)
            dl, dg = ImageDraw.Draw(lay), ImageDraw.Draw(glow)
            for ring in self.borders:
                u, v, _, _, _ = view.project(ring[:, 0], ring[:, 1])
                pts = list(zip(((u + W / 2) * k).tolist(), ((v + H / 2) * k).tolist()))
                part = sz._partial(pts, f)
                if len(part) > 1:
                    dl.line(part, fill=(255, 255, 255, 190), width=max(1, int(round(2.2 * k))), joint="curve")
                    dg.line(part, fill=150, width=max(2, int(8 * k)))
            gl = Image.new("RGBA", img.size, (255, 255, 255, 0))
            gl.putalpha(glow.filter(ImageFilter.GaussianBlur(6 * k)).point(lambda p: int(p * 0.35)))
            img.alpha_composite(gl)
        # the named places come up one after another
        placed = []
        for i, p in enumerate(self.sc.get("labels") or []):
            t0 = self.lab_t + 0.28 * i
            if t < t0:
                continue
            wx, wy = world(p["lon"], p["lat"])
            u, v, _, _, _ = view.project(np.array([wx]), np.array([wy]))
            x, y = (float(u[0]) + W / 2) * k, (float(v[0]) + H / 2) * k
            _dot(lay, x, y, k, (255, 236, 200), _back((t - t0) / 0.3) * 0.8, ring=(255, 255, 255), glow=0.8)
            placed.append((x - 12 * k, y - 12 * k, x + 12 * k, y + 12 * k))
            _place(lay, x, y, p["label"], k, placed, size=26, alpha=_smooth((t - t0 - 0.08) / 0.25))
        img.alpha_composite(lay)
        self.text.draw(img, t, self.tl)
        _credit(img, k, CREDITS["night"])
        return img.convert("RGB")

    def prefetch(self, fps: int = FPS, log=print):
        need = set()
        n = int(round(float(self.sc["duration"]) * fps))
        for i in range(0, n, 3):
            need |= ground_needs(self._view(i / fps), self.w, self.h, self.k)
        more = set()
        for (z, x, y) in need:
            while z > 0:
                z, x, y = z - 1, x // 2, y // 2
                if (z, x, y) in need or (z, x, y) in more:
                    break
                more.add((z, x, y))
        self.day.fetch(sorted(need | more), log=log)
        self.night.fetch(sorted(q for q in (need | more) if q[0] <= 8), log=log)

    def sounds(self) -> list:
        a, b = self.fall
        out = [(b, "riser", -12.0), (a, "whoosh", -10.0), (self.draw_b[0], "tap", -14.0)]
        out += [(round(self.lab_t + 0.28 * i, 3), "ping", -11.0) for i in range(len(self.sc.get("labels") or []))]
        return out + _typing_sounds(self.sc, self.tl) + [(float(self.sc["duration"]), "whoosh_out", -11.0)]


# ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
# FLYOVER
# ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
def flyover_scene(place: dict, waypoints: list, title: str = "", kicker: str = "", duration: float = None,
                  hit: float = None, accent: str = ACCENT, lang: str = "", log=print):
    """A low flight over one city past 2 to 4 of its landmarks, or None when fewer than two can be placed."""
    city = str(place.get("name") or "")
    pts = []
    for w_ in list(waypoints or [])[:4]:
        q = dict(w_, city=w_.get("city") or city, country=w_.get("country") or place.get("country"),
                 type=w_.get("type") or "site")
        f = sz.find(q, log=log, buildings=False)
        if not f:
            continue
        pts.append({"label": str(w_.get("label") or w_.get("name") or ""), "lon": float(f["lon"]), "lat": float(f["lat"]),
                    "outline": f.get("outline"), "osm": f.get("osm") or "", "shape_osm": f.get("shape_osm") or "",
                    "building": f.get("category") == "building"})
    if len(pts) < 2:
        log(f"  satfx: a flyover needs two places it can find — got {len(pts)}")
        return None
    lons, lats = [p_["lon"] for p_ in pts], [p_["lat"] for p_ in pts]
    lat0, lon0 = (min(lats) + max(lats)) / 2, (min(lons) + max(lons)) / 2
    reach = max(sz._km(lon0, lat0, a, b) for a, b in zip(lons, lats)) * 1000.0
    if reach > 9000:
        log("  satfx: a flyover's places lie more than 9 km apart — a zoom or a pin fits them better")
        return None
    blds = sz._buildings(lat0, lon0, min(4200.0, reach + 900.0), cap=16000)
    # each place's own building: the same OpenStreetMap element, else the largest standing inside its outline
    for p_ in pts:
        idx = next((i for i, b in enumerate(blds) if b["osm"] in (p_["osm"], p_["shape_osm"]) and b["osm"]), None)
        if idx is None and p_["outline"]:
            inside = [i for i, b in enumerate(blds) if sz._in_ring(b["c"][0], b["c"][1], p_["outline"])]
            idx = max(inside, key=lambda i: blds[i]["area"], default=None)
        if idx is None:
            near = [i for i, b in enumerate(blds) if sz._km(p_["lon"], p_["lat"], *b["c"]) < 0.08]
            idx = max(near, key=lambda i: blds[i]["area"], default=None)
        p_["key"] = idx
    gaps = [sz._km(a["lon"], a["lat"], b["lon"], b["lat"]) * 1000 for a, b in zip(pts, pts[1:])]
    spacing = sorted(gaps)[len(gaps) // 2]
    z = max(15.3, min(17.3, math.log2(156543.03392 * math.cos(math.radians(lat0)) * 820 / max(spacing, 200.0))))
    return {"shot": "flyover", "waypoints": [{k_: v for k_, v in p_.items() if k_ != "outline"} for p_ in pts],
            "outlines": [p_["outline"] for p_ in pts], "z": round(z, 3), "lat": lat0, "lon": lon0,
            "title": str(title or ""), "kicker": str(kicker or ""), "accent": accent, "lang": _lang(lang),
            "duration": float(duration or DUR["flyover"]), "hit": float(LEAD["flyover"] if hit is None else hit),
            "_buildings": blds}


def _catmull(P: np.ndarray, n: int = 600) -> np.ndarray:
    """A smooth curve through the points (Catmull-Rom), sampled n times."""
    P = np.vstack([P[0] - (P[1] - P[0]) * 0.25, P, P[-1] + (P[-1] - P[-2]) * 0.06])
    out = []
    segs = len(P) - 3
    for i in range(segs):
        p0, p1, p2, p3 = P[i], P[i + 1], P[i + 2], P[i + 3]
        for u in np.linspace(0, 1, max(2, n // segs), endpoint=(i == segs - 1)):
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u
                              + (-p0 + 3 * p1 - 3 * p2 + p3) * u ** 3))
    return np.asarray(out)


class FlyoverShot:
    TURN_DEG_S = 30.0

    def __init__(self, sc: dict, size=(W, H)):
        self.sc, (self.w, self.h) = sc, size
        self.k = self.h / H
        self.ss = 2 if self.k > 0.75 else 3
        self.accent = _rgb(sc.get("accent"))
        self.tiles = Tiles()
        self.vig = _vignette(self.w, self.h)
        self.lat = float(sc["lat"])
        blds = sc.get("_buildings") or []
        self.wp = sc["waypoints"]
        self.blocks = sz.Blocks(blds, self.lat, self.accent, self.k)
        self.outlines = [world_arr(o) if o else None for o in sc.get("outlines") or [None] * len(self.wp)]
        P = np.asarray([world(w_["lon"], w_["lat"]) for w_ in self.wp], dtype=np.float64)
        # the path: a lead-in, the places in order, a little past the last; walked at an even speed
        self.path = _catmull(P)
        seg = np.hypot(*np.diff(self.path, axis=0).T)
        self.cum = np.concatenate([[0], np.cumsum(seg)])
        self.cum /= max(self.cum[-1], 1e-12)
        self.u_wp = [float(self.cum[int(np.argmin(np.hypot(*(self.path - q).T)))]) for q in P]
        dur = float(sc["duration"])
        self.fly = (0.0, dur - 1.3)                                  # then it hovers over the last place
        self.text, self.tl = _texts(sc, self.k, self.accent, 0.35, scale=0.7)
        self.on_t = [self._t_of(u - 0.10) for u in self.u_wp]       # a place lights up as it comes into view
        # the heading, planned frame by frame like a drone pilot flies it: mostly the flight's overall direction,
        # partly the path's own, and never turning faster than TURN_DEG_S — a hairpin (Kim Il Sung Square ->
        # Juche Tower -> Ryugyong) spun the camera 160 degrees in half a second
        g = P[-1] - P[0]
        g = g / (np.linalg.norm(g) or 1.0)
        n = int(round(dur * FPS)) + 2
        want = []
        for i in range(n):
            s_ = self._s(i / FPS)
            d = self._at(min(1.0, s_ + 0.06)) - self._at(max(0.0, s_ - 0.02))
            d = d / (np.linalg.norm(d) or 1.0)
            v = 0.55 * g + 0.45 * d
            v = v if np.linalg.norm(v) > 0.2 else g
            want.append(math.atan2(v[0], -v[1]))
        step = math.radians(self.TURN_DEG_S) / FPS
        head = [want[0]]
        for w_ in want[1:]:
            dlt = (w_ - head[-1] + math.pi) % (2 * math.pi) - math.pi
            head.append(head[-1] + max(-step, min(step, dlt)))
        k_ = 7                                                         # and eased, so turns start and end softly
        pad = [head[0]] * k_ + head + [head[-1]] * k_
        self.heading = [sum(pad[i:i + 2 * k_ + 1]) / (2 * k_ + 1) for i in range(len(head))]

    def _s(self, t: float) -> float:
        a, b = self.fly
        u = _clamp((t - a) / (b - a))
        return 0.5 - 0.5 * math.cos(math.pi * u)                    # gentle start, gentle landing

    def _t_of(self, s_: float) -> float:
        a, b = self.fly
        s_ = _clamp(s_, 0, 1)
        return a + (b - a) * math.acos(1 - 2 * s_) / math.pi

    def _at(self, s_: float) -> np.ndarray:
        i = np.searchsorted(self.cum, s_)
        i = int(min(max(i, 1), len(self.cum) - 1))
        f = (s_ - self.cum[i - 1]) / max(self.cum[i] - self.cum[i - 1], 1e-12)
        return self.path[i - 1] + (self.path[i] - self.path[i - 1]) * f

    def _view(self, t: float) -> View:
        s_ = self._s(t)
        pos = self._at(s_)
        f = t * FPS
        i = int(min(max(f, 0), len(self.heading) - 2))
        bearing = self.heading[i] + (self.heading[i + 1] - self.heading[i]) * min(1.0, max(0.0, f - i))
        z = float(self.sc["z"]) - 0.3 * math.sin(math.pi * s_)      # a little higher in the middle of the flight
        return View({"z": z, "pitch": math.radians(58.0), "bearing": bearing, "dz": 0.0,
                     "target": (float(pos[0]), float(pos[1])), "pin": (W / 2, H / 2 + 170)})

    def frame(self, t: float) -> Image.Image:
        k, s = self.k, self.ss
        view = self._view(t)
        g = render_ground(view, self.tiles, self.w, self.h, k) * self.vig
        img = Image.fromarray(np.clip(g, 0, 255).astype(np.uint8), "RGB").convert("RGBA")
        acc = self.accent
        lit = {}
        # the places' grounds, outlined and lightly filled once they are lit
        flat = Image.new("RGBA", (self.w * s, self.h * s), (0, 0, 0, 0))
        fd = ImageDraw.Draw(flat)
        for i, (w_, ol) in enumerate(zip(self.wp, self.outlines)):
            a = _smooth((t - self.on_t[i]) / 0.45)
            if a <= 0:
                continue
            if w_.get("key") is not None:
                lit[int(w_["key"])] = a
            if ol is not None:
                u, v, _, _, _ = view.project(ol[:, 0], ol[:, 1])
                pts = list(zip(((u + W / 2) * k * s).tolist(), ((v + H / 2) * k * s).tolist()))
                fd.polygon(pts, fill=acc + (int(70 * a),))
                fd.line(pts + pts[:1], fill=acc + (int(255 * a),), width=max(2, int(round(3.6 * k * s))), joint="curve")
        img.alpha_composite(flat.resize((self.w, self.h), Image.BOX))
        bl = self.blocks.draw(view, self.w * s, self.h * s, s, 1.0, 0.0, lit)
        if bl is not None:
            img.alpha_composite(bl.resize((self.w, self.h), Image.BOX))
        # the names, each on its place's roof
        lay = Image.new("RGBA", img.size, (0, 0, 0, 0))
        placed = []
        mpp = m_per_px(self.lat, view.z)
        for i, w_ in enumerate(self.wp):
            if t < self.on_t[i]:
                continue
            h_ = 0.0
            if w_.get("key") is not None and int(w_["key"]) < len(self.blocks.bld):
                h_ = sz._drawn(self.blocks.bld[int(w_["key"])]["h"])
            wx, wy = world(w_["lon"], w_["lat"])
            u, v, _, _, _ = view.project(np.array([wx]), np.array([wy]), h_ / mpp)
            x, y = (float(u[0]) + W / 2) * k, (float(v[0]) + H / 2) * k
            _dot(lay, x, y, k, acc, _back((t - self.on_t[i]) / 0.3), glow=0.5)
            placed.append((x - 14 * k, y - 14 * k, x + 14 * k, y + 14 * k))
            _place(lay, x, y, w_["label"], k, placed, font="Inter-ExtraBold.ttf", size=28, fg=(12, 12, 12, 255),
                   bg=acc + (235,), alpha=_smooth((t - self.on_t[i] - 0.1) / 0.3))
        img.alpha_composite(lay)
        # the city's name opens the flight, then gives the frame to the places
        fade = 1 - _smooth((t - 3.4) / 0.6)
        if fade > 0:
            tl_ = Image.new("RGBA", img.size, (0, 0, 0, 0))
            self.text.draw(tl_, t, self.tl)
            if fade < 1:
                al = np.asarray(tl_.getchannel("A")).astype(np.float32) * fade
                tl_.putalpha(Image.fromarray(al.astype(np.uint8)))
            img.alpha_composite(tl_)
        _credit(img, k, CREDITS["flyover"])
        return img.convert("RGB")

    def prefetch(self, fps: int = FPS, log=print):
        need = set()
        n = int(round(float(self.sc["duration"]) * fps))
        for i in range(0, n, 3):
            need |= ground_needs(self._view(i / fps), self.w, self.h, self.k)
        more = set()
        for (z, x, y) in need:
            while z > 0:
                z, x, y = z - 1, x // 2, y // 2
                if (z, x, y) in need or (z, x, y) in more:
                    break
                more.add((z, x, y))
        self.tiles.fetch(sorted(need | more), log=log)

    def sounds(self) -> list:
        out = [(0.05, "whoosh", -8.0)] + [(round(t, 3), "ping", -10.0) for t in self.on_t]
        out += [(round(t + 0.02, 3), "pop", -13.0) for t in self.on_t]
        return out + _typing_sounds(self.sc, self.tl) + [(float(self.sc["duration"]), "whoosh_out", -11.0)]


# ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
SHOTS = {"range": RangeShot, "then_now": ThenNowShot, "night": NightShot, "flyover": FlyoverShot}


def render(sc: dict, out: Path, size=(W, H), fps: int = FPS, workers: int = 4, log=print) -> Path:
    """One scene of any of the three skills -> out (mp4) + out.sfx.json."""
    shot = SHOTS[sc["shot"]](sc, size)
    shot.prefetch(fps, log=log)
    return _encode(shot.frame, float(sc["duration"]), out, shot.sounds(), fps, workers, log)


def _cli():
    import argparse
    ap = argparse.ArgumentParser(description="Satellite map skills: range, then_now, night.")
    ap.add_argument("shot", choices=list(SHOTS))
    ap.add_argument("place")
    ap.add_argument("--city", default="")
    ap.add_argument("--country", default="")
    ap.add_argument("--type", default="")
    ap.add_argument("--lat", type=float)
    ap.add_argument("--lon", type=float)
    ap.add_argument("--km", type=float, nargs="*", default=[])
    ap.add_argument("--targets", nargs="*", default=[])
    ap.add_argument("--arcs", action="store_true", help="range: a flight path to every target")
    ap.add_argument("--then", type=int, default=2015)
    ap.add_argument("--now", type=int)
    ap.add_argument("--labels", nargs="*", default=[])
    ap.add_argument("--waypoints", nargs="*", default=[], help="flyover: the landmarks, in flight order")
    ap.add_argument("--borders", nargs="*", default=[])
    ap.add_argument("--span", type=float)
    ap.add_argument("--title", default="")
    ap.add_argument("--kicker", default="")
    ap.add_argument("--accent", default=ACCENT)
    ap.add_argument("--lang", default="cs")
    ap.add_argument("--size", default="1920x1080")
    ap.add_argument("--frames", type=float, nargs="*")
    ap.add_argument("--out", default=str(HERE / "preview"))
    ap.add_argument("--workers", type=int, default=4)
    a = ap.parse_args()
    place = {"name": a.place, "city": a.city, "country": a.country, "type": a.type or "site"}
    if a.lat is not None and a.lon is not None:
        place.update(lat=a.lat, lon=a.lon)
    if a.shot == "range":
        sc = range_scene(place, a.km, [{"name": x, "arc": a.arcs} for x in a.targets], a.title, a.kicker,
                         accent=a.accent, lang=a.lang)
    elif a.shot == "then_now":
        sc = then_now_scene(place, a.then, a.now, a.title, a.kicker, accent=a.accent, lang=a.lang)
    elif a.shot == "flyover":
        sc = flyover_scene(place, [{"name": x, "country": a.country} for x in a.waypoints], a.title, a.kicker,
                           accent=a.accent, lang=a.lang)
    else:
        sc = night_scene(place, [{"name": x} for x in a.labels], a.borders, a.span, a.title, a.kicker,
                         accent=a.accent, lang=a.lang)
    if not sc:
        sys.exit("nothing to render")
    w, h = (int(x) for x in a.size.lower().split("x"))
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    slug = re.sub(r"[^a-z0-9]+", "_", f"{a.shot}_{a.place}".lower()).strip("_")[:50]
    if a.frames:
        shot = SHOTS[sc["shot"]](sc, (w, h))
        shot.prefetch()
        for t in a.frames:
            p = out / f"{slug}_{t:05.2f}.jpg"
            shot.frame(t).save(p, quality=92)
            print(p)
    else:
        print(render(sc, out / f"{slug}.mp4", (w, h), workers=a.workers))


if __name__ == "__main__":
    _cli()
