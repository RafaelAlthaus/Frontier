#!/usr/bin/env python3
"""satzoom.py — the camera dives from space onto one exact place, on real satellite imagery.

When the narration names a place smaller than a country — a palace, a base, a camp, a square, a building,
a district, a city — a map can do more than drop a pin. The whole Earth fills the frame, the camera dives
down to the place, tilts into 3D while the buildings stand up, the place's real outline draws itself, the
rest of the city darkens and the name comes up. Robin's reference (2026-09-26) was a dive from the globe to
Apple Park; the camera here follows the curve measured on it frame by frame: a held world, a log-zoom on a
cubic ease-in-out that peaks at ten zoom levels a second, a pivot about the place pinned just below the
middle of the frame, a tilt to 57 degrees with a slow turn, then the outline, the fill, the dot, the words.

Where it comes from:
    imagery     Esri World Imagery tiles (its credit line stays on screen)
    the place   OpenStreetMap through Nominatim — its real outline when it has one
    buildings   OpenStreetMap through Overpass — footprints and heights, drawn as white 3D blocks

Drawn in Python (numpy + Pillow), not in a browser: no WebGL and no GPU, so a Mac, a Windows PC and a
render-farm machine make the same frames. Tiles and lookups are cached in ~/.frontier/satzoom/.

    python satzoom.py show "Apple Park" --city Cupertino --country "United States" --title "Apple Park" --kicker "welcome to"
    python satzoom.py show "Kumsusan Palace of the Sun" --city Pyongyang --country "North Korea" --title "Palác Kumsusan"
    python satzoom.py frames "Apple Park" --city Cupertino --t 1.5 3.2 4.5 6.4      # stills, to check a look fast
"""

import hashlib
import io
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = Path(__file__).resolve().parent
FONTS = HERE / "assets" / "fonts"
W, H, FPS = 1920, 1080, 30                # the camera works in 1080p units; smaller renders scale from them
CACHE = Path(os.environ.get("SATZOOM_CACHE") or (Path.home() / ".frontier" / "satzoom"))
TILE_URL = os.environ.get("SATZOOM_TILES",
                          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}")
CREDIT = os.environ.get("SATZOOM_CREDIT", "Imagery © Esri, Maxar, Earthstar Geographics · Buildings © OpenStreetMap")
UA = {"User-Agent": "Frontier/5 (documentary video tool; satellite zoom)"}
NOMINATIM = "https://nominatim.openstreetmap.org/search"
OVERPASS = ("https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter")
MISSING_MD5 = {"f27d9de7f80c13501f470595e327aa6d"}        # Esri's grey "Map data not yet available" tile
MAX_Z = 19

# ── the move, measured on the reference ─────────────────────────────────────────────────────────────────────
DUR = 7.2                 # a zoom scene (the reference ran 6.6 s; the extra is held on the finished frame)
LEAD_S = 3.1              # from the scene's start to the moment the place lights up — that lands on the word
MIN_DUR = 5.6             # shorter and the name has no time on screen (a short one dives faster)
PIN = (W / 2, H / 2 + 110)    # the place stays on this point of the screen through the dive, the tilt and the turn
FOV_D = 1.5 * H           # camera distance for a 36.87-degree vertical field of view, as map engines use
Z0 = 3.0                  # the whole Earth at the start: the world a little wider than the frame
FRAME_PX = 800            # the place's size on screen when the dive ends (Apple Park: 1.29 km -> zoom 16.2)
HEIGHT_X = 1.5            # low buildings stand a little taller than life, as map engines draw them; towers stay true
MAX_DRAWN_M = 120.0       # no block is drawn taller than this
PITCH = 56.0              # the tilt at the end, degrees
# The dive's progress (0..1) every 0.1 s, measured frame by frame on the reference, whose place lit up at
# REF_HIT: held for half a second, then a zoom that peaks at ten levels a second and settles by 4.2 s.
REF_HIT = 3.1
ZOOM_CURVE = (0.0000, 0.0000, 0.0000, 0.0000, 0.0000, 0.0000, 0.0002, 0.0009, 0.0027, 0.0058, 0.0107, 0.0179,
              0.0276, 0.0401, 0.0561, 0.0759, 0.0999, 0.1285, 0.1621, 0.2012, 0.2455, 0.2965, 0.3537, 0.4182,
              0.4900, 0.5652, 0.6329, 0.6939, 0.7478, 0.7955, 0.8370, 0.8729, 0.9035, 0.9305, 0.9521, 0.9696,
              0.9815, 0.9897, 0.9943, 0.9979, 0.9994, 1.0000, 1.0000, 1.0000, 1.0000, 1.0000)
TURN = -18.0              # the turn during the tilt, degrees (negative: the view swings to the left)
DRIFT = -2.4              # the slow turn while the name holds, degrees a second
ACCENT = "#FFC400"


def _clamp(x, a=0.0, b=1.0):
    return a if x < a else b if x > b else x


def _cubic(u):
    u = _clamp(u)
    return 4 * u ** 3 if u < 0.5 else 1 - (-2 * u + 2) ** 3 / 2


def _smooth(u):
    u = _clamp(u)
    return u * u * (3 - 2 * u)


def _back(u, s=1.8):
    u = _clamp(u) - 1
    return 1 + (s + 1) * u ** 3 + s * u ** 2


def _dive(t_ref: float) -> float:
    """The reference's dive progress at t_ref seconds, read smoothly between its 0.1 s samples (Catmull-Rom)."""
    x = t_ref / 0.1
    n = len(ZOOM_CURVE)
    if x <= 0:
        return 0.0
    if x >= n - 1:
        return 1.0
    i = int(x)
    f = x - i
    p0, p1 = ZOOM_CURVE[max(0, i - 1)], ZOOM_CURVE[i]
    p2, p3 = ZOOM_CURVE[min(n - 1, i + 1)], ZOOM_CURVE[min(n - 1, i + 2)]
    v = 0.5 * ((2 * p1) + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (-p0 + 3 * p1 - 3 * p2 + p3) * f ** 3)
    return _clamp(v)


def _rgb(hexs, fallback=ACCENT):
    s = str(hexs or fallback).strip().lstrip("#")
    if not re.fullmatch(r"[0-9a-fA-F]{6}", s):
        s = fallback.lstrip("#")
    return tuple(int(s[i:i + 2], 16) for i in (0, 2, 4))


# ── Web Mercator: world pixels at zoom 0 (the world is 256 x 256) ───────────────────────────────────────────
def world(lon, lat):
    lat = max(-85.05, min(85.05, float(lat)))
    x = (float(lon) + 180.0) / 360.0 * 256.0
    y = (1.0 - math.log(math.tan(math.radians(lat)) + 1.0 / math.cos(math.radians(lat))) / math.pi) / 2.0 * 256.0
    return x, y


def world_arr(lonlat):
    a = np.asarray(lonlat, dtype=np.float64).reshape(-1, 2)
    lat = np.clip(a[:, 1], -85.05, 85.05)
    x = (a[:, 0] + 180.0) / 360.0 * 256.0
    y = (1.0 - np.log(np.tan(np.radians(lat)) + 1.0 / np.cos(np.radians(lat))) / np.pi) / 2.0 * 256.0
    return np.stack([x, y], axis=1)


def m_per_px(lat, z):
    """Metres on the ground per world pixel at zoom z."""
    return 156543.03392 * math.cos(math.radians(lat)) / (2.0 ** z)


def _km(lon1, lat1, lon2, lat2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 2 * 6371.0088 * math.asin(min(1.0, math.sqrt(a)))


# ── lookups: Nominatim (the place and its outline), Overpass (the buildings) ────────────────────────────────
_NOM_LOCK = threading.Lock()
_NOM_LAST = [0.0]


def _cached(kind: str, key: str, fetch):
    d = CACHE / kind
    d.mkdir(parents=True, exist_ok=True)
    f = d / (hashlib.md5(key.encode("utf-8")).hexdigest() + ".json")
    if f.exists():
        try:
            return json.loads(f.read_text(encoding="utf-8"))
        except ValueError:
            pass
    got = fetch()
    if got is not None:
        f.write_text(json.dumps(got, ensure_ascii=False), encoding="utf-8")
    return got


def _nominatim(q: str) -> list:
    import requests

    def fetch():
        for k in range(3):
            with _NOM_LOCK:                           # their rule: one request a second, a named client
                wait = 1.1 - (time.time() - _NOM_LAST[0])
                if wait > 0:
                    time.sleep(wait)
                _NOM_LAST[0] = time.time()
                try:
                    r = requests.get(NOMINATIM, params={"q": q, "format": "jsonv2", "polygon_geojson": 1, "limit": 6,
                                                        "extratags": 1, "accept-language": "en"}, headers=UA, timeout=40)
                    if r.status_code == 200:
                        return r.json()
                except Exception:                     # noqa: BLE001 - a network blip; try again
                    pass
            time.sleep(2 + 3 * k)
        return None
    return _cached("geo", "nominatim2|" + q, fetch) or []


def _overpass(query: str):
    import requests

    def fetch():
        # a busy public server must not hold a whole video up: three short tries across the mirrors, then
        # the zoom goes on without its 3D buildings (the outline and the lit shape still come from Nominatim)
        for k in range(3):
            url = OVERPASS[k % len(OVERPASS)]
            try:
                r = requests.post(url, data={"data": query}, headers=UA, timeout=75)
                if r.status_code == 200:
                    return r.json()
            except Exception:                         # noqa: BLE001 - busy servers answer on the next try
                pass
            time.sleep(3)
        return None
    return _cached("osm", query, fetch)


def _polys(geo: dict) -> list:
    """The polygons of a GeoJSON (multi)polygon, largest first, each [outer, hole, ...] of [[lon, lat], ...]."""
    t, c = (geo or {}).get("type"), (geo or {}).get("coordinates") or []
    polys = [c] if t == "Polygon" else c if t == "MultiPolygon" else []
    out = [[r for r in p if len(r) >= 4] for p in polys if p and len(p[0]) >= 4]
    return sorted(out, key=lambda p: -abs(_ring_area_m2(p[0])))


def _rings(geo: dict) -> list:
    """The outer rings of a GeoJSON (multi)polygon, largest first, as [[lon, lat], ...]."""
    return [p[0] for p in _polys(geo)]


def _ring_area_m2(ring) -> float:
    if len(ring) < 3:
        return 0.0
    lat0 = sum(p[1] for p in ring) / len(ring)
    kx, ky = 111320.0 * math.cos(math.radians(lat0)), 110540.0
    a = 0.0
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        a += (x1 * kx) * (y2 * ky) - (x2 * kx) * (y1 * ky)
    return a / 2.0


def _centroid(ring) -> list:
    """The area centroid of a ring (lon, lat) — the middle of the grounds, where the camera aims."""
    a = cx = cy = 0.0
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        f = x1 * y2 - x2 * y1
        a, cx, cy = a + f, cx + (x1 + x2) * f, cy + (y1 + y2) * f
    if abs(a) < 1e-14:
        return [sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring)]
    return [cx / (3 * a), cy / (3 * a)]


def _extent_m(ring) -> float:
    lons, lats = [p[0] for p in ring], [p[1] for p in ring]
    lat0 = (min(lats) + max(lats)) / 2
    return max((max(lons) - min(lons)) * 111320.0 * math.cos(math.radians(lat0)), (max(lats) - min(lats)) * 110540.0)


def _in_ring(lon, lat, ring) -> bool:
    inside, j = False, len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / ((yj - yi) or 1e-12) + xi:
            inside = not inside
        j = i
    return inside


def _hx(h: float) -> float:
    """How much taller than life a building is drawn: HEIGHT_X up to 30 m, true height from 90 m."""
    return HEIGHT_X - (HEIGHT_X - 1.0) * _clamp((float(h) - 30.0) / 60.0)


def _drawn(h: float) -> float:
    """The height a building is drawn at. A footprint says nothing of a tower's shape — the Ryugyong Hotel came
    out a 330 m yellow prism over the title — so blocks stop at MAX_DRAWN_M and the imagery shows the rest."""
    return min(float(h) * _hx(h), MAX_DRAWN_M)


def _height(tags: dict, area: float) -> float:
    def num(v):
        m = re.match(r"\s*([0-9]+(?:[.,][0-9]+)?)", str(v or ""))
        return float(m.group(1).replace(",", ".")) if m else None
    h = num(tags.get("height"))
    if h is not None and "'" in str(tags.get("height")):
        h *= 0.3048
    if h is None and num(tags.get("building:levels")) is not None:
        h = num(tags.get("building:levels")) * 3.1 + 1.0
    if h is None:
        kind = str(tags.get("building") or "yes")
        h = {"house": 6, "detached": 6, "semidetached_house": 6, "terrace": 7, "garage": 3, "garages": 3, "shed": 3,
             "roof": 4, "apartments": 15, "residential": 9, "commercial": 11, "office": 14, "retail": 7,
             "industrial": 9, "warehouse": 9, "church": 16, "cathedral": 24, "palace": 18, "hotel": 22,
             "school": 10, "hospital": 16, "train_station": 12, "stadium": 22}.get(kind)
        if h is None:
            h = 5.0 if area < 120 else 8.0 if area < 600 else 12.0 if area < 3000 else 15.0
    return float(max(2.5, min(h, 400.0)))


def _assemble(ways: list) -> list:
    """Closed rings from a multipolygon's member ways, which OpenStreetMap often splits into pieces."""
    pool, rings = [list(w) for w in ways if len(w) >= 2], []
    while pool:
        cur = pool.pop(0)
        grew = True
        while cur[0] != cur[-1] and grew:
            grew = False
            for i, w in enumerate(pool):
                if w[0] == cur[-1]:
                    cur = cur + w[1:]
                elif w[-1] == cur[-1]:
                    cur = cur + w[::-1][1:]
                elif w[-1] == cur[0]:
                    cur = w + cur[1:]
                elif w[0] == cur[0]:
                    cur = w[::-1] + cur[1:]
                else:
                    continue
                pool.pop(i)
                grew = True
                break
        if len(cur) >= 4 and cur[0] == cur[-1]:
            rings.append(cur)
    return rings


def _buildings(lat: float, lon: float, radius_m: float, cap: int = 12000) -> list:
    """Every building footprint within radius_m: [{"rings": [outer, inner...] in lon/lat, "h": metres, "area": m2}]."""
    dlat = radius_m / 110540.0
    dlon = radius_m / (111320.0 * max(0.2, math.cos(math.radians(lat))))
    bb = f"{lat - dlat:.5f},{lon - dlon:.5f},{lat + dlat:.5f},{lon + dlon:.5f}"
    # ways need only their shape; a relation needs its members (`out tags` would drop them, and with them
    # every building with a courtyard — Apple Park's ring among them)
    data = _overpass(f'[out:json][timeout:120];way["building"]({bb});out tags geom;'
                     f'relation["building"]["type"="multipolygon"]({bb});out geom;')
    out = []
    for e in (data or {}).get("elements", []):
        tags = e.get("tags") or {}
        shapes = []
        if e.get("type") == "way":
            g = [[p["lon"], p["lat"]] for p in e.get("geometry") or []]
            if len(g) >= 4 and g[0] == g[-1]:
                shapes = [[g]]
        elif e.get("type") == "relation":
            members = e.get("members") or []
            pts = lambda m: [[p["lon"], p["lat"]] for p in m.get("geometry") or []]
            outer = _assemble([pts(m) for m in members if m.get("role") == "outer" and m.get("geometry")])
            inner = _assemble([pts(m) for m in members if m.get("role") == "inner" and m.get("geometry")])
            # one building per outer ring, each with the courtyards inside it
            shapes = [[o] + [i for i in inner if _in_ring(i[0][0], i[0][1], o)] for o in outer]
        for rings in shapes:
            area = abs(_ring_area_m2(rings[0])) - sum(abs(_ring_area_m2(r)) for r in rings[1:])
            if area < 12:
                continue
            cx = sum(p[0] for p in rings[0]) / len(rings[0])
            cy = sum(p[1] for p in rings[0]) / len(rings[0])
            out.append({"rings": rings, "h": _height(tags, area), "area": area, "c": [cx, cy],
                        "name": str(tags.get("name") or ""), "osm": f"{e.get('type')}/{e.get('id')}"})
    out.sort(key=lambda b: _km(lon, lat, b["c"][0], b["c"][1]))
    return out[:cap]


def _max_zoom(lon: float, lat: float) -> int:
    """The deepest zoom Esri has real imagery for at this spot."""
    tiles = Tiles()
    x0, y0 = world(lon, lat)
    for z in range(MAX_Z, 12, -1):
        n = 2 ** z
        tx, ty = int(x0 / 256 * n), int(y0 / 256 * n)
        if tiles.load(z, tx % n, ty) is not None:
            return z
    return 12


def find(place: dict, log=print, buildings: bool = True) -> dict:
    """The place on the ground: where it is, its real outline, its buildings. None when it cannot be found.

    place: the map designer's object — "name" and "names" (English, then local), "city", "country",
    "type", and "lat"/"lon" (a best guess: it rejects a namesake on the other side of the world, and it
    is the place itself when OpenStreetMap does not know it)."""
    names = [str(n).strip() for n in [place.get("name")] + list(place.get("names") or []) if str(n or "").strip()]
    names = list(dict.fromkeys(names))[:4]
    city, country = str(place.get("city") or "").strip(), str(place.get("country") or "").strip()
    kind = str(place.get("type") or "").lower()
    try:
        guess = (float(place["lon"]), float(place["lat"]))
    except (KeyError, TypeError, ValueError):
        guess = None
    small = kind not in ("city", "town", "district", "region", "island", "lake")
    cands = []
    for nm in names:
        queries = ([f"{nm}, {city}, {country}"] if city and country else []) + \
                  ([f"{nm}, {city}"] if city else []) + ([f"{nm}, {country}"] if country else []) + [nm]
        for q in dict.fromkeys(queries):
            for r in _nominatim(q):
                try:
                    lon, lat = float(r["lon"]), float(r["lat"])
                except (KeyError, TypeError, ValueError):
                    continue
                d = _km(lon, lat, *guess) if guess else 0.0
                if guess and d > (40.0 if small else 120.0):
                    continue                          # a namesake somewhere else
                rings = _rings(r.get("geojson"))
                ext = _extent_m(rings[0]) if rings else 0.0
                if small and ext > 25000:
                    continue                          # asked for a building, got a whole district
                score = float(r.get("importance") or 0.0) + (0.35 if rings else 0.0) - (d / 60.0 if guess else 0.0)
                if kind in ("city", "town") and r.get("category") in ("boundary", "place"):
                    score += 0.4
                cands.append(dict(r, _rings=rings, _q=q, _score=score, _area=abs(_ring_area_m2(rings[0])) if rings else 0.0))
            if any(c["_rings"] for c in cands):
                break
        if any(c["_rings"] for c in cands):
            break
    if not cands and guess is None:
        return None
    best, shape, shape_id = None, None, ""
    if cands:
        best = max(cands, key=lambda c: c["_score"])
        # OpenStreetMap often has the grounds and the main building under one name (Apple Park: the campus and
        # the ring; Kumsusan: the palace grounds and the palace). The outline is the grounds — the largest shape
        # of that place nearby — unless a building was asked for; a smaller one may stand in as the main building.
        near = [c for c in cands if c["_rings"] and _km(float(c["lon"]), float(c["lat"]),
                                                          float(best["lon"]), float(best["lat"])) < 3.0]
        if near and kind != "building":
            site = max(near, key=lambda c: c["_area"])
            rest = [c for c in near if c is not site and c["_area"] < 0.6 * site["_area"]
                    and _in_ring(float(c["lon"]), float(c["lat"]), site["_rings"][0])]
            if rest:
                sc_ = max(rest, key=lambda c: c["_area"])
                shape, shape_id = _polys(sc_.get("geojson"))[0], f"{sc_.get('osm_type')}/{sc_.get('osm_id')}"
            best = site
    if best is not None:
        lon, lat, outline = float(best["lon"]), float(best["lat"]), (best["_rings"][0] if best["_rings"] else None)
        src = f"OpenStreetMap ({best.get('category')}/{best.get('type')}, '{best['_q']}')"
    else:
        lon, lat, outline, src = guess[0], guess[1], None, "the designer's coordinates"
    size = max(_extent_m(outline) if outline else 0.0, 380.0 if small else 2500.0)
    zmax = _max_zoom(lon, lat)
    z1 = min(math.log2(156543.03392 * math.cos(math.radians(lat)) * FRAME_PX / size), zmax - 0.25, 18.4)
    z1 = max(z1, 9.0)
    found = {"lon": lon, "lat": lat, "pin": _centroid(outline) if outline else [lon, lat],
             "outline": outline, "size_m": round(size, 1), "z1": round(z1, 3),
             "zmax": zmax, "source": src, "buildings": [], "key": None,
             # which OpenStreetMap elements these are, so another shot can find their buildings
             "osm": f"{best.get('osm_type')}/{best.get('osm_id')}" if best is not None else "",
             "shape_osm": shape_id, "category": str((best or {}).get("category") or "")}
    if z1 >= 14.5 and buildings:
        found["buildings"] = _buildings(lat, lon, max(900.0, min(2600.0, 2.4 * size)))
        # the place's main building lights up in the accent: the element itself when it is a building,
        # else the largest one standing inside its outline (if it is big enough to mean something)
        bl = found["buildings"]
        if shape:
            # the place's own smaller shape under the same name is its main building (Apple Park's ring,
            # the Kumsusan palace): it stands up in the accent, as tall as the mapped buildings inside it
            o = shape[0]
            s_area = abs(_ring_area_m2(o))
            under = [b for b in bl if _in_ring(b["c"][0], b["c"][1], o)
                     and not any(_in_ring(b["c"][0], b["c"][1], hole) for hole in shape[1:])]
            # the same OpenStreetMap element among the buildings (its courtyards, its height), else a building
            # covering most of the shape
            main = next((b for b in bl if b["osm"] == shape_id), None) or \
                max((b for b in under if b["area"] >= 0.35 * s_area), key=lambda b: b["area"], default=None)
            if main is not None:
                # the mapped building itself, with its courtyards and its height
                found["key"] = bl.index(main)
            else:
                h = max([b["h"] for b in under if b["area"] > 0.05 * s_area] or [22.0])
                bl[:] = [b for b in bl if b not in under]
                c = [sum(p[0] for p in o) / len(o), sum(p[1] for p in o) / len(o)]
                area = s_area - sum(abs(_ring_area_m2(r)) for r in shape[1:])
                bl.insert(0, {"rings": shape, "h": h, "area": area, "c": c, "name": "", "osm": "nominatim"})
                found["key"] = 0
        elif best is not None and best.get("category") == "building" and outline:
            poly = _polys(best.get("geojson"))[0]
            same = next((i for i, b in enumerate(bl) if b["osm"] == f"{best.get('osm_type')}/{best.get('osm_id')}"), None)
            if same is not None:
                found["key"] = same
            else:
                area = abs(_ring_area_m2(poly[0])) - sum(abs(_ring_area_m2(r)) for r in poly[1:])
                bl.insert(0, {"rings": poly, "h": _height(best.get("extratags") or {}, area), "area": area,
                              "c": _centroid(poly[0]), "name": "", "osm": "nominatim"})
                found["key"] = 0
        else:
            pool = [i for i, b in enumerate(bl) if outline and _in_ring(b["c"][0], b["c"][1], outline)]
            if pool:
                site_area = abs(_ring_area_m2(outline)) if outline else 0.0
                k = max(pool, key=lambda i: bl[i]["area"])
                if bl[k]["area"] >= max(250.0, 0.02 * site_area):
                    found["key"] = k
    if found["key"] is not None:
        # a tower needs room above it, or its top runs into the name
        tall = _drawn(found["buildings"][found["key"]]["h"])
        if 2.2 * tall > found["size_m"]:
            found["size_m"] = round(2.2 * tall, 1)
            found["z1"] = round(max(9.0, min(math.log2(156543.03392 * math.cos(math.radians(lat)) * FRAME_PX
                                                        / found["size_m"]), zmax - 0.25, 18.4)), 3)
    log(f"  satzoom: {names[0] if names else '?'} — {src}; outline {'yes' if outline else 'no'}, "
        f"{len(found['buildings'])} buildings, zoom {found['z1']:.1f} (imagery to {zmax})")
    return found


# ── tiles ───────────────────────────────────────────────────────────────────────────────────────────────────
_SPACE = np.array([7, 11, 20], dtype=np.uint8)


class Tiles:
    """Esri imagery tiles on disk (~/.frontier/satzoom/tiles) and decoded in memory. A tile Esri has no
    imagery for comes from its parent, enlarged — so a zoom never shows the grey 'no data' square."""

    def __init__(self, url: str = TILE_URL, mem: int = 1400, max_z: int = MAX_Z):
        self.url, self.max_z = url, max_z
        self.dir = CACHE / "tiles" / hashlib.md5(url.encode("utf-8")).hexdigest()[:10]
        self.mem, self.cap, self.lock = OrderedDict(), mem, threading.Lock()

    def _path(self, z, x, y):
        return self.dir / str(z) / str(x) / f"{y}.jpg"

    def _download(self, key) -> bool:
        import requests
        z, x, y = key
        p = self._path(z, x, y)
        if p.exists() or p.with_suffix(".none").exists():
            return True
        p.parent.mkdir(parents=True, exist_ok=True)
        for k in range(4):
            try:
                r = requests.get(self.url.format(z=z, x=x, y=y), headers=UA, timeout=30)
                if r.status_code == 200 and r.content:
                    if hashlib.md5(r.content).hexdigest() in MISSING_MD5:
                        p.with_suffix(".none").write_bytes(b"")
                    else:
                        tmp = p.with_suffix(".part")
                        tmp.write_bytes(r.content)
                        tmp.replace(p)
                    return True
                if r.status_code in (400, 404):
                    p.with_suffix(".none").write_bytes(b"")
                    return True
            except Exception:                         # noqa: BLE001 - retried
                pass
            time.sleep(1.5 * (k + 1))
        return False

    def fetch(self, keys, workers: int = 16, log=print) -> int:
        todo = [k for k in keys if k[0] <= self.max_z and not self._path(*k).exists()
                and not self._path(*k).with_suffix(".none").exists()]
        if not todo:
            return 0
        log(f"  satzoom: downloading {len(todo)} imagery tiles...")
        with ThreadPoolExecutor(max_workers=workers) as ex:
            ok = sum(1 for got in ex.map(self._download, todo) if got)
        if ok < len(todo):
            log(f"  satzoom: {len(todo) - ok} tile(s) did not download — their parents stand in")
        return ok

    def load(self, z, x, y):
        """A tile straight from disk (downloading it if needed), or None when Esri has no imagery there."""
        p = self._path(z, x, y)
        if not p.exists() and not p.with_suffix(".none").exists():
            self._download((z, x, y))
        if p.exists():
            try:
                return np.asarray(Image.open(p).convert("RGB"))
            except Exception:                         # noqa: BLE001 - a truncated file: fetch it again
                p.unlink(missing_ok=True)
        return None

    def get(self, z, x, y) -> np.ndarray:
        n = 1 << z
        if y < 0 or y >= n:
            return np.broadcast_to(_SPACE, (256, 256, 3))
        x %= n
        key = (z, x, y)
        with self.lock:
            if key in self.mem:
                self.mem.move_to_end(key)
                return self.mem[key]
        a = None
        p = self._path(z, x, y)
        if z <= self.max_z and p.exists():
            try:
                a = np.asarray(Image.open(p).convert("RGB"))
            except Exception:                         # noqa: BLE001
                a = None
        if a is None or a.shape[:2] != (256, 256):
            if z == 0:
                a = np.broadcast_to(_SPACE, (256, 256, 3))
            else:
                par = self.get(z - 1, x // 2, y // 2)
                q = par[(y % 2) * 128:(y % 2) * 128 + 128, (x % 2) * 128:(x % 2) * 128 + 128]
                a = np.asarray(Image.fromarray(np.ascontiguousarray(q)).resize((256, 256), Image.BILINEAR))
        with self.lock:
            self.mem[key] = a
            while len(self.mem) > self.cap:
                self.mem.popitem(last=False)
        return a


# ── the camera ──────────────────────────────────────────────────────────────────────────────────────────────
def timeline(sc: dict) -> dict:
    """When everything happens in a scene, from its hit (the moment the place lights up)."""
    hit, dur = float(sc["hit"]), float(sc["duration"])
    d0 = max(0.15, hit - 2.55)
    d1 = hit + (1.10 if hit - 2.55 >= 0.15 else 1.10 * (hit - 0.15) / 2.55)
    k0 = hit + 1.65
    nk = len(str(sc.get("kicker") or ""))
    dt = min(0.075, 0.75 / max(1, nk)) if nk else 0.0
    t0 = k0 + nk * dt + (0.12 if nk else 0.0)
    return {"d0": d0, "d1": d1, "hit": hit, "tilt": (hit, hit + 1.0), "turn": (hit, hit + 1.2),
            "grow": (hit + 0.3, hit + 0.6), "draw": (hit + 0.55, hit + 1.2), "fill": (hit + 1.15, hit + 1.6),
            "dot": hit + 1.3, "kicker": (k0, dt), "title": min(t0, dur - 0.9), "end": dur}


def _t_ref(tl: dict, t: float) -> float:
    """The scene's time on the reference's clock: the same after the hit; before it, a lead shorter than the
    reference's squeezes the dive instead of starting it half-way."""
    hit = tl["hit"]
    if t >= hit or hit >= REF_HIT - 0.45:
        return t - hit + REF_HIT
    return 0.45 + (t / max(hit, 1e-3)) * (REF_HIT - 0.45)


def camera(sc: dict, tl: dict, t: float) -> dict:
    z0, z1 = float(sc["z0"]), float(sc["z1"])
    z = z0 + (z1 - z0) * _dive(_t_ref(tl, t))
    a, b = tl["tilt"]
    pitch = float(sc.get("pitch", PITCH)) * _smooth((t - a) / (b - a))
    a, b = tl["turn"]
    bearing = float(sc.get("turn", TURN)) * _smooth((t - a) / (b - a)) + \
        float(sc.get("drift", DRIFT)) * max(0.0, t - (a + 0.6))
    # how fast the zoom runs, for the blur of the fastest frames
    dz = (z1 - z0) * (_dive(_t_ref(tl, t + 0.5 / FPS)) - _dive(_t_ref(tl, t - 0.5 / FPS)))
    return {"z": z, "pitch": math.radians(pitch), "bearing": math.radians(bearing), "dz": dz,
            "target": world(sc["lon"], sc["lat"])}


class View:
    """One frame's camera: ground <-> screen, in 1080p units (u, v from the middle of the frame)."""

    def __init__(self, cam: dict):
        self.z = cam["z"]
        self.s, self.c = math.sin(cam["pitch"]), math.cos(cam["pitch"])
        self.sb, self.cb = math.sin(cam["bearing"]), math.cos(cam["bearing"])
        self.D = FOV_D
        self.scale = 2.0 ** self.z
        tx, ty = cam["target"]
        # centre the camera so the place sits on PIN
        pin = cam.get("pin") or PIN                    # a shot may hold its place elsewhere on the screen
        X, Y = self.ground(np.array([pin[0] - W / 2]), np.array([pin[1] - H / 2]))
        ox, oy = self.to_world_offset(X, Y)
        self.cx, self.cy = tx - float(ox[0]) / self.scale, ty - float(oy[0]) / self.scale

    def ground(self, u, v):
        g = 1.0 / np.maximum(self.D * self.c + v * self.s, 1e-6)
        return u * self.D * self.c * g, -v * self.D * g

    def to_world_offset(self, X, Y):
        return X * self.cb + Y * self.sb, X * self.sb - Y * self.cb

    def project(self, wx, wy, zpx=0.0):
        """World pixels at zoom 0 (+ a height in zoom-z pixels) -> screen (u, v) and depth."""
        ox, oy = (wx - self.cx) * self.scale, (wy - self.cy) * self.scale
        X = ox * self.cb + oy * self.sb
        Y = ox * self.sb - oy * self.cb
        depth = Y * self.s - zpx * self.c + self.D
        depth = np.maximum(depth, 1e-3)
        return self.D * X / depth, self.D * (-Y * self.c - zpx * self.s) / depth, depth, X, Y


# ── the ground: every pixel sampled from the tile level that matches its size on screen ─────────────────────
def _sample(tiles: Tiles, level: int, wx: np.ndarray, wy: np.ndarray, cx: float) -> np.ndarray:
    n = 1 << level
    size = 256 * n
    tx, ty = wx * n - 0.5, wy * n - 0.5
    ty = np.clip(ty, 0, size - 1.001)
    # x wraps round the Earth: measure it from the middle of the view, so a view across the date line
    # still reads one strip of tiles instead of the whole world
    c = cx * n
    tx = np.mod(tx - c + size / 2, size) - size / 2 + c
    span = float(tx.max() - tx.min()) if tx.size else 0.0
    if span > 0.9 * size or level <= 1:
        # the whole world at this level: small enough to build at once, and x wraps around it
        tx = np.mod(tx, size)
        tx0, ty0, nx, ny = 0, 0, n, n
        mosaic = np.empty((n * 256, n * 256, 3), np.uint8)
        for j in range(n):
            for i in range(n):
                mosaic[j * 256:(j + 1) * 256, i * 256:(i + 1) * 256] = tiles.get(level, i, j)
        wrap = True
    else:
        tx0, tx1 = int(math.floor(tx.min() / 256)), int(math.floor((tx.max() + 1) / 256))
        ty0, ty1 = int(math.floor(ty.min() / 256)), int(math.floor((ty.max() + 1) / 256))
        nx, ny = tx1 - tx0 + 1, ty1 - ty0 + 1
        mosaic = np.empty((ny * 256, nx * 256, 3), np.uint8)
        for j in range(ny):
            for i in range(nx):
                mosaic[j * 256:(j + 1) * 256, i * 256:(i + 1) * 256] = tiles.get(level, tx0 + i, ty0 + j)
        wrap = False
    mx = tx - tx0 * 256
    my = ty - ty0 * 256
    x0 = np.floor(mx).astype(np.int64)
    y0 = np.floor(my).astype(np.int64)
    fx = (mx - x0).astype(np.float32)[..., None]
    fy = (my - y0).astype(np.float32)[..., None]
    wm, hm = mosaic.shape[1], mosaic.shape[0]
    if wrap:
        x0 %= wm
        x1 = (x0 + 1) % wm
    else:
        x0 = np.clip(x0, 0, wm - 1)
        x1 = np.clip(x0 + 1, 0, wm - 1)
    y0 = np.clip(y0, 0, hm - 1)
    y1 = np.clip(y0 + 1, 0, hm - 1)
    flat = mosaic.reshape(-1, 3)
    a = flat[y0 * wm + x0].astype(np.float32)
    b = flat[y0 * wm + x1].astype(np.float32)
    c = flat[y1 * wm + x0].astype(np.float32)
    d = flat[y1 * wm + x1].astype(np.float32)
    top = a + (b - a) * fx
    bot = c + (d - c) * fx
    return top + (bot - top) * fy


def _rows(view: View, h_out: int, k: float):
    """Per output row: v (1080p units), the tile level it needs and the haze of its distance."""
    v = (np.arange(h_out, dtype=np.float64) + 0.5) / k - H / 2
    denom = view.D * view.c + v * view.s
    g = 1.0 / np.maximum(denom, 1e-6)
    sx = view.D * view.c * g
    sy = view.D * view.D * view.c * g * g
    m = np.power(sx, 0.4) * np.power(sy, 0.6)
    level = view.z + math.log2(k) - np.log2(np.maximum(m, 1e-9))
    haze = np.clip((view.D * g * view.c - 1.25) / 5.0, 0.0, 0.42) * _clamp(view.s / 0.5)
    return v, level, haze, denom > 1.0


def ground_needs(view: View, w_out: int, h_out: int, k: float, step: int = 12) -> set:
    """The tiles a frame reads, from a coarse grid of its pixels."""
    v, level, _, ok = _rows(view, h_out, k)
    need = set()
    cols = (np.append(np.arange(0, w_out, step), w_out - 1).astype(np.float64) + 0.5) / k - W / 2
    for r in list(range(0, h_out, step)) + [h_out - 1]:
        if not ok[r]:
            continue
        X, Y = view.ground(cols, np.full_like(cols, v[r]))
        ox, oy = view.to_world_offset(X, Y)
        wx, wy = view.cx + ox / view.scale, view.cy + oy / view.scale
        l0 = int(math.floor(_clamp(level[r], 0, MAX_Z - 0.001)))
        for lv in (l0, min(MAX_Z, l0 + 1)):
            n = 1 << lv
            tx = np.floor(np.mod(wx * n, n * 256) / 256).astype(int)
            ty = np.clip(np.floor(wy * n / 256).astype(int), 0, n - 1)
            need.update((lv, int(a) % n, int(b)) for a, b in zip(tx, ty))
    return need


def render_ground(view: View, tiles: Tiles, w_out: int, h_out: int, k: float, want_xy: bool = False):
    """The ground under the camera; with want_xy also (wx, wy): every pixel's world position (zoom-0 pixels)."""
    v, level, haze, ok = _rows(view, h_out, k)
    out = np.empty((h_out, w_out, 3), np.float32)
    out[:] = _SPACE
    if want_xy:
        WX = np.full((h_out, w_out), np.nan)
        WY = np.full((h_out, w_out), np.nan)
    cols = (np.arange(w_out, dtype=np.float64) + 0.5) / k - W / 2
    lv = np.clip(level, 0, MAX_Z - 0.001)
    l0 = np.floor(lv).astype(int)
    frac = (lv - l0).astype(np.float32)
    r = 0
    while r < h_out:
        if not ok[r]:
            r += 1
            continue
        r1 = r
        while r1 + 1 < h_out and ok[r1 + 1] and l0[r1 + 1] == l0[r]:
            r1 += 1
        rows = slice(r, r1 + 1)
        vv = v[rows][:, None]
        uu = cols[None, :]
        X, Y = view.ground(uu, vv)
        ox, oy = view.to_world_offset(X, Y)
        wx, wy = view.cx + ox / view.scale, view.cy + oy / view.scale
        if want_xy:
            WX[rows], WY[rows] = wx, wy
        lo = _sample(tiles, int(l0[r]), wx, wy, view.cx)
        f = frac[rows][:, None, None]
        if float(f.max()) > 0.02 and l0[r] < MAX_Z:
            hi = _sample(tiles, int(l0[r]) + 1, wx, wy, view.cx)
            lo = lo + (hi - lo) * f
        hz = haze[rows][:, None, None].astype(np.float32)
        out[rows] = lo * (1 - hz) + np.array([24, 29, 34], np.float32) * hz
        r = r1 + 1
    return (out, WX, WY) if want_xy else out


# ── drawing helpers ─────────────────────────────────────────────────────────────────────────────────────────
_FONT_CACHE = {}


def _font(name: str, size: int):
    key = (name, int(size))
    if key not in _FONT_CACHE:
        _FONT_CACHE[key] = ImageFont.truetype(str(FONTS / name), int(size))
    return _FONT_CACHE[key]


def _vignette(w, h):
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    r = np.sqrt(((x - w / 2) / (w / 2)) ** 2 + ((y - h / 2) / (h / 2)) ** 2) / math.sqrt(2)
    t = np.clip((r - 0.42) / 0.62, 0, 1)
    return (1 - 0.42 * t * t * (3 - 2 * t))[..., None]


def _partial(pts: list, frac: float) -> list:
    """The first `frac` of a polyline, by length."""
    if frac >= 1 or len(pts) < 2:
        return pts
    seg = [math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(pts, pts[1:])]
    goal, acc, out = frac * sum(seg), 0.0, [pts[0]]
    for (a, b), s in zip(zip(pts, pts[1:]), seg):
        if acc + s >= goal:
            f = (goal - acc) / (s or 1)
            out.append((a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f))
            return out
        out.append(b)
        acc += s
    return out


class Text:
    """The kicker (typed on, each letter sharpening out of a blur) and the title (flickering on), sized and
    placed as in the reference: the kicker's letters from y=64, the title's from y=155, both centred."""
    K_FONT, K_SIZE, K_TRACK, K_TOP = "InterDisplay-Black.ttf", 86, -0.035, 64
    # the title: Anton drawn at 89 % of its width — the reference's tall, heavy capitals with open spacing
    T_FONT, T_SIZE, T_TRACK, T_TOP, T_GAP, T_SQUEEZE = "Anton-Regular.ttf", 220, 0.012, 155, 28, 0.89
    MAX_W = 1700

    def __init__(self, kicker: str, title: str, accent, k: float, scale: float = 1.0):
        # scale: a smaller lettering for a shot that needs the frame (a globe); still centred on the frame
        self.k, self.accent = k, accent
        self.kicker, self.title = kicker.strip(), title.strip().upper()
        size = self.K_SIZE
        while self.kicker and self._width(self.kicker, self.K_FONT, size, self.K_TRACK) > 1500 and size > 40:
            size -= 3
        self.kf, self.ktrack = _font(self.K_FONT, max(8, int(round(size * k * scale)))), self.K_TRACK * size * k * scale
        size = self.T_SIZE
        lines = [self.title]
        while self._width(self.title, self.T_FONT, size, self.T_TRACK) * self.T_SQUEEZE > self.MAX_W and size > 150:
            size -= 6
        if self._width(self.title, self.T_FONT, size, self.T_TRACK) * self.T_SQUEEZE > self.MAX_W and " " in self.title:
            words, best = self.title.split(), None
            for i in range(1, len(words)):
                pair = [" ".join(words[:i]), " ".join(words[i:])]
                w_ = max(self._width(x, self.T_FONT, size, self.T_TRACK) for x in pair)
                if best is None or w_ < best[0]:
                    best = (w_, pair)
            lines = best[1]
        while max(self._width(x, self.T_FONT, size, self.T_TRACK) for x in lines) * self.T_SQUEEZE > self.MAX_W \
                and size > 60:
            size -= 6
        self.tf, self.ttrack, self.lines = _font(self.T_FONT, max(8, int(round(size * k * scale)))), \
            self.T_TRACK * size * k * scale, lines
        self.ktop = self.K_TOP * k * scale
        self.ttop = (self.K_TOP + (127 - 64) + self.T_GAP) * k * scale if self.kicker else 110 * k * scale
        cap = self.tf.getbbox("A")
        self.bottom = self.ttop + (cap[3] - cap[1]) * (1 + 1.18 * (len(lines) - 1))     # where the title ends
        # the kicker's letters: where each one sits, and its own little picture (drawn once)
        self._chars, x = [], W * k / 2 - self._track_w(self.kicker, self.kf, self.ktrack) / 2
        box_top = self.kf.getbbox(self.kicker or "x")[1]
        pad = int(34 * k)                                  # room for the wide shadow round each letter
        bh = int(self.kf.size * 1.3) + 2 * pad
        for ch in self.kicker:
            adv = self.kf.getlength(ch)
            if ch.strip():
                cw = int(adv + 2 * pad)
                img, mask = self._gradient(ch, self.kf, (255, 255, 255), (206, 206, 206), cw, bh, pad, pad - box_top)
                self._chars.append((x - pad, self._shadowed(img, mask, 8 * k, 0.6, 4 * k)))
            x += adv + self.ktrack
        self._ky = int(round(self.ktop - pad))
        self._title_img = self._make_title()

    @staticmethod
    def _width(text, font_name, size, track):
        f = _font(font_name, size)
        return sum(f.getlength(ch) for ch in text) + track * size * max(0, len(text) - 1)

    @staticmethod
    def _track_w(text, font, track):
        return sum(font.getlength(ch) for ch in text) + track * max(0, len(text) - 1)

    @staticmethod
    def _gradient(text, font, top, bottom, box_w, box_h, x, y, track=0.0):
        mask = Image.new("L", (max(1, int(box_w)), max(1, int(box_h))), 0)
        dm = ImageDraw.Draw(mask)
        for ch in text:
            dm.text((x, y), ch, font=font, fill=255)
            x += font.getlength(ch) + track
        bb = mask.getbbox() or (0, 0, 1, 1)
        h_ = max(1, bb[3] - bb[1])
        grad = np.clip((np.arange(mask.height, dtype=np.float32) - bb[1]) / h_, 0, 1)[:, None, None]
        col = np.array(top, np.float32) * (1 - grad) + np.array(bottom, np.float32) * grad
        col = np.broadcast_to(col, (mask.height, mask.width, 3)).astype(np.uint8)
        img = Image.fromarray(np.ascontiguousarray(col), "RGB").convert("RGBA")
        img.putalpha(mask)
        return img, mask

    @staticmethod
    def _shadowed(img, mask, blur, alpha, dy):
        # two shadows so the lettering reads over busy satellite imagery (Robin, 27 Sep 2026: "trochu shadow"):
        # a wide soft veil, then a tight dark shadow just under the letters
        out = Image.new("RGBA", img.size, (0, 0, 0, 0))
        for b_, a_, d_ in ((blur * 2.6, min(0.62, alpha * 1.1), dy * 1.4), (blur * 0.55, min(0.9, alpha + 0.3), dy * 0.8)):
            sh = Image.new("RGBA", img.size, (0, 0, 0, 0))
            sh.putalpha(mask.point(lambda p, a_=a_: int(p * a_)).filter(ImageFilter.GaussianBlur(b_)))
            out.alpha_composite(sh, (0, int(d_)))
        out.alpha_composite(img)
        return out

    def _make_title(self):
        k, sq = self.k, self.T_SQUEEZE
        top_off = self.tf.getbbox("A")[1]
        line_h = self.tf.getbbox("A")[3] - top_off
        bw = int(W * k / sq)                              # drawn wide, then squeezed to the frame's width
        bh = int(line_h * (len(self.lines) * 1.18) + 130 * k)
        img = Image.new("RGBA", (bw, bh), (0, 0, 0, 0))
        mask = Image.new("L", (bw, bh), 0)
        y = int(50 * k) - top_off
        for ln in self.lines:
            lw = self._track_w(ln, self.tf, self.ttrack)
            part, pm = self._gradient(ln, self.tf, self.accent, tuple(int(c * 0.9) for c in self.accent),
                                      bw, bh, (bw - lw) / 2, y, self.ttrack)
            img.alpha_composite(part)
            mask = Image.fromarray(np.maximum(np.asarray(mask), np.asarray(pm)))
            y += int(line_h * 1.18)
        self._title_dy = int(50 * k)
        img = img.resize((int(W * k), bh), Image.LANCZOS)
        mask = mask.resize((int(W * k), bh), Image.LANCZOS)
        return self._shadowed(img, mask, 10 * k, 0.5, 5 * k)

    def draw(self, frame: Image.Image, t: float, tl: dict):
        k0, dt = tl["kicker"]
        if self.kicker and t >= k0:
            i = 0
            for x, img in self._chars:
                a = _smooth((t - (k0 + i * dt)) / 0.16)
                i += 1
                if a <= 0:
                    continue
                if a < 1:
                    img = img.filter(ImageFilter.GaussianBlur(7 * self.k * (1 - a)))
                    al = np.asarray(img.getchannel("A")).astype(np.float32) * a
                    img.putalpha(Image.fromarray(al.astype(np.uint8)))
                frame.alpha_composite(img, (max(0, int(x)), max(0, self._ky + int(8 * self.k * (1 - a)))))
        t0 = tl["title"]
        if t >= t0:
            keys = [(0.0, 0.0), (0.05, 0.75), (0.10, 0.28), (0.16, 0.9), (0.21, 0.5), (0.30, 1.0)]
            dtt, a = t - t0, 1.0
            for (ta, va), (tb, vb) in zip(keys, keys[1:]):
                if ta <= dtt < tb:
                    a = va + (vb - va) * (dtt - ta) / (tb - ta)
                    break
            img = self._title_img
            if a < 1:
                img = img.copy()
                al = np.asarray(img.getchannel("A")).astype(np.float32) * a
                img.putalpha(Image.fromarray(al.astype(np.uint8)))
            frame.alpha_composite(img, (0, max(0, int(self.ttop) - self._title_dy)))


def _credit(frame: Image.Image, k: float, text: str = None):
    text = text or CREDIT
    f = _font("Inter-SemiBold.ttf", max(9, int(round(17 * k))))
    w = f.getlength(text)
    x, y = frame.width - w - 22 * k, frame.height - 36 * k
    layer = Image.new("RGBA", frame.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.text((x + 1, y + 1), text, font=f, fill=(0, 0, 0, 150))
    d.text((x, y), text, font=f, fill=(255, 255, 255, 225))
    frame.alpha_composite(layer)


# ── one frame ───────────────────────────────────────────────────────────────────────────────────────────────
class Blocks:
    """A city's buildings as white 3D blocks, flattened for numpy: every ring's vertices in one array (each ring
    closed), one row per edge, and per building the slice of its rings and edges — a frame projects them all at
    once. The zoom lights one of them; a flyover lights one after another."""

    def __init__(self, buildings: list, lat: float, accent, k: float, keys=(), inside_ring=None):
        self.lat, self.accent, self.k = lat, accent, k
        self.bld = []
        keys = {x for x in keys if x is not None}
        verts, vh, e_a, r_first, r_inner, r_bld, r_rng = [], [], [], [], [], [], []
        n_v = 0
        for i, b in enumerate(buildings):
            rings = [world_arr(r) for r in b["rings"]]
            rings = [r if np.allclose(r[0], r[-1]) else np.vstack([r, r[:1]]) for r in rings]
            e0, rr0 = len(e_a), len(r_first)
            for j, r in enumerate(rings):
                r_first.append(n_v)
                r_rng.append((n_v, n_v + len(r)))
                r_inner.append(j > 0)
                r_bld.append(len(self.bld))
                e_a.extend(range(n_v, n_v + len(r) - 1))
                verts.append(r)
                vh.append(np.full(len(r), float(b["h"])))
                n_v += len(r)
            inside = bool(inside_ring and _in_ring(b["c"][0], b["c"][1], inside_ring))
            self.bld.append({"rings": rings, "h": float(b["h"]), "key": i in keys, "inside": inside,
                             "area": float(b.get("area") or 0.0),
                             "edges": (e0, len(e_a)), "ring_ids": (rr0, len(r_first)),
                             "outer": r_rng[rr0]})
        if self.bld:
            self.V = np.concatenate(verts)
            self.Vh = np.concatenate(vh)
            # drawn height over true height, per vertex: the projection multiplies them
            self.Vx = np.concatenate([np.full(len(v_), _drawn(bb["h"]) / max(bb["h"], 1e-6))
                                      for v_, bb in zip(verts, [self.bld[r_bld[q]] for q in range(len(verts))])])
            self.Ea = np.asarray(e_a, dtype=np.int64)
            self.Er = np.repeat(np.arange(len(r_first)), [r_rng[q][1] - r_rng[q][0] - 1 for q in range(len(r_first))])
            self.r_inner = np.asarray(r_inner)
            self.r_rng = r_rng
            self.outer_first = np.asarray([b["outer"][0] for b in self.bld])

    def draw(self, view: View, sc_w: int, sc_h: int, s: int, fade: float = 1.0, dim: float = 0.0, lit=None):
        """The blocks on a transparent layer s times the frame's size. lit: {building index: 0..1} lights those
        in the accent (None: the key buildings, fully)."""
        if fade <= 0 or not self.bld:
            return None
        layer = Image.new("RGBA", (sc_w, sc_h), (0, 0, 0, 0))
        d = ImageDraw.Draw(layer)
        mpp = m_per_px(self.lat, view.z)
        f = self.k * s
        V = self.V
        ub, vb, dep, X, Y = view.project(V[:, 0], V[:, 1])
        ut, vt, _, _, _ = view.project(V[:, 0], V[:, 1], self.Vh * self.Vx / mpp)
        bx, by, tx_, ty_ = (ub + W / 2) * f, (vb + H / 2) * f, (ut + W / 2) * f, (vt + H / 2) * f
        # per building (its rings are contiguous): the screen box of base and roof, its depth, its wall height
        a0 = self.outer_first
        mnx = np.minimum(np.minimum.reduceat(bx, a0), np.minimum.reduceat(tx_, a0))
        mxx = np.maximum(np.maximum.reduceat(bx, a0), np.maximum.reduceat(tx_, a0))
        mny = np.minimum(np.minimum.reduceat(by, a0), np.minimum.reduceat(ty_, a0))
        mxy = np.maximum(np.maximum.reduceat(by, a0), np.maximum.reduceat(ty_, a0))
        cnt = np.diff(np.append(a0, len(V)))
        bdep = np.add.reduceat(dep, a0) / np.maximum(cnt, 1)
        wall_px = np.maximum.reduceat(by - ty_, a0) / s
        mg = 60 * f
        vis = (mxx > -mg) & (mnx < sc_w + mg) & (mxy > -mg) & (mny < sc_h + mg) & \
              (((mxx - mnx) / s >= 0.9) | ((mxy - mny) / s >= 0.9))
        # every edge: which way its wall faces (outward, a courtyard's inward), is it toward the camera, its light
        Ea, Eb, Er = self.Ea, self.Ea + 1, self.Er
        cross = X[Ea] * Y[Eb] - X[Eb] * Y[Ea]
        area_r = np.bincount(Er, weights=cross, minlength=len(self.r_rng))
        sign_r = np.where(area_r > 0, 1.0, -1.0) * np.where(self.r_inner, -1.0, 1.0)
        sg = sign_r[Er]
        nx, ny = (Y[Eb] - Y[Ea]) * sg, -(X[Eb] - X[Ea]) * sg
        mx, my = (X[Ea] + X[Eb]) / 2, (Y[Ea] + Y[Eb]) / 2
        facing = nx * (0.0 - mx) + ny * (-view.D * view.s - my) > 0
        ln = np.hypot(nx, ny) + 1e-9
        ex = (nx * view.cb + ny * view.sb) / ln          # the wall's normal on the map (east, north)
        ey = (-nx * view.sb + ny * view.cb) / ln
        # the sun from the north-west, fixed on the ground: the walls shade as the camera turns
        shade = 0.60 + 0.36 * np.clip(ex * -0.62 + ey * 0.78, 0, 1)
        edep = (dep[Ea] + dep[Eb]) / 2
        base_roof, base_wall = np.array([214, 212, 204], np.float32), np.array([184, 182, 174], np.float32)
        acc = np.array(self.accent, np.float32)
        BX, BY, TX, TY = bx.tolist(), by.tolist(), tx_.tolist(), ty_.tolist()
        EA, FACE, SH = Ea.tolist(), facing.tolist(), shade.tolist()
        for bi in sorted(np.nonzero(vis)[0].tolist(), key=lambda i: -bdep[i]):       # far to near
            b = self.bld[bi]
            glow = (1.0 if b["key"] else 0.0) if lit is None else float(lit.get(bi, 0.0))
            key = glow > 0.5
            small = b["area"] < 400
            dimf = 1.0 if (b["inside"] or key) else 1.0 - (0.5 if small else 0.22) * dim
            # the city's blocks sit in the picture rather than on it, and fade into the distance
            far = _clamp(1.0 - (bdep[bi] / view.D - 1.05) / 0.7, 0.06, 1.0)
            # houses stay quiet; the big blocks carry the 3D
            al = int(255 * (0.6 if small else 0.9) * far)
            al = int(al + (255 - al) * glow)
            roof = base_roof + (acc - base_roof) * glow
            wall = base_wall + (acc * 0.86 - base_wall) * glow
            roof_c = tuple(int(x) for x in np.clip(roof * dimf, 0, 255)) + (al,)
            wall_c = wall * dimf
            if wall_px[bi] >= 0.5:
                e0, e1 = b["edges"]
                idx = [e for e in range(e0, e1) if FACE[e]]
                idx.sort(key=lambda e: -edep[e])
                for e in idx:
                    a = EA[e]
                    sh = SH[e]
                    d.polygon([(BX[a], BY[a]), (BX[a + 1], BY[a + 1]), (TX[a + 1], TY[a + 1]), (TX[a], TY[a])],
                              fill=(int(min(255, wall_c[0] * sh)), int(min(255, wall_c[1] * sh)),
                                    int(min(255, wall_c[2] * sh)), al))
            r0, r1 = b["ring_ids"]
            s0, s1 = self.r_rng[r0]
            if r1 - r0 == 1:
                d.polygon(list(zip(TX[s0:s1], TY[s0:s1])), fill=roof_c)
            else:
                x0, y0 = int(max(0, mnx[bi] - 2)), int(max(0, mny[bi] - 2))
                x1, y1 = int(min(sc_w, mxx[bi] + 3)), int(min(sc_h, mxy[bi] + 3))
                if x1 > x0 and y1 > y0:
                    m = Image.new("L", (x1 - x0, y1 - y0), 0)
                    dm = ImageDraw.Draw(m)
                    dm.polygon([(a - x0, c_ - y0) for a, c_ in zip(TX[s0:s1], TY[s0:s1])], fill=255)
                    for q in range(r0 + 1, r1):
                        q0, q1 = self.r_rng[q]
                        dm.polygon([(a - x0, c_ - y0) for a, c_ in zip(TX[q0:q1], TY[q0:q1])], fill=0)
                    patch = Image.new("RGBA", (x1 - x0, y1 - y0), roof_c)
                    patch.putalpha(m)
                    layer.alpha_composite(patch, (x0, y0))
        if fade < 1:
            al = np.asarray(layer.getchannel("A")).astype(np.float32) * fade
            layer.putalpha(Image.fromarray(al.astype(np.uint8)))
        return layer


class Scene:
    """Everything a zoom scene needs, prepared once: the place, its outline and buildings in world pixels."""

    def __init__(self, sc: dict, found: dict, size=(W, H)):
        self.sc, self.found = sc, found
        self.w, self.h = size
        self.k = self.h / H
        self.ss = 2 if self.k > 0.75 else 3
        self.tl = timeline(sc)
        self.dot = world(*(sc.get("dot") or (sc["lon"], sc["lat"])))
        self.accent = _rgb(sc.get("accent"))
        self.tiles = Tiles()
        self.vig = _vignette(self.w, self.h)
        self.text = Text(str(sc.get("kicker") or ""), str(sc.get("title") or ""), self.accent, self.k)
        lat = float(found["lat"])
        self.lat = lat
        self.outline = world_arr(found["outline"]) if found.get("outline") else None
        if self.outline is not None and len(self.outline) and not np.allclose(self.outline[0], self.outline[-1]):
            self.outline = np.vstack([self.outline, self.outline[:1]])
        self.blocks = Blocks(found.get("buildings") or [], lat, self.accent, self.k,
                             keys={found.get("key")}, inside_ring=found.get("outline"))
        self.bld = self.blocks.bld
        self.key = next((b for b in self.bld if b["key"]), None)
        # a dot that falls on the main building sits on its roof, not on its wall
        self.dot_h = 0.0
        if self.key is not None:
            ring0 = self.key["rings"][0].tolist()
            holes = [r.tolist() for r in self.key["rings"][1:]]
            if _in_ring(self.dot[0], self.dot[1], ring0) and not any(_in_ring(self.dot[0], self.dot[1], h_) for h_ in holes):
                self.dot_h = _drawn(self.key["h"])
        size_m = float(found["size_m"])
        self.ring_m = (0.05 * size_m, 0.085 * size_m)     # the faint rings round the dot

    def _flat(self, view: View, t: float, sc_w, sc_h, s):
        """The layer on the ground: the fill, the outline drawing itself, the rings round the dot, and the
        main building's footprint lighting up before it stands up."""
        tl = self.tl
        layer = Image.new("RGBA", (sc_w, sc_h), (0, 0, 0, 0))
        glow = Image.new("L", (self.w, self.h), 0)
        d, dg = ImageDraw.Draw(layer), ImageDraw.Draw(glow)
        acc = self.accent

        def to_px(pts, mult):
            u, v, _, _, _ = view.project(pts[:, 0], pts[:, 1])
            return list(zip(((u + W / 2) * self.k * mult).tolist(), ((v + H / 2) * self.k * mult).tolist()))

        fill_a = _smooth((t - tl["fill"][0]) / (tl["fill"][1] - tl["fill"][0]))
        draw_f = _smooth((t - tl["draw"][0]) / (tl["draw"][1] - tl["draw"][0]))
        if self.outline is not None and t >= tl["draw"][0]:
            pts = to_px(self.outline, s)
            if fill_a > 0:
                d.polygon(pts, fill=acc + (int(92 * fill_a),))
            part = _partial(pts, draw_f)
            if len(part) >= 2:
                d.line(part, fill=acc + (255,), width=max(2, int(round(4.2 * self.k * s))), joint="curve")
                dg.line(_partial(to_px(self.outline, 1), draw_f), fill=int(210), width=max(3, int(10 * self.k)))
        # rings round the dot: two quiet circles on the ground and a slow pulse between them
        if t >= tl["dot"]:
            ra = _smooth((t - tl["dot"]) / 0.5)
            tx, ty = self.dot
            mpp0 = m_per_px(self.lat, 0)
            ang = np.linspace(0, 2 * math.pi, 73)
            pulse = ((t - tl["dot"]) % 1.6) / 1.6
            for r_m, a in ((self.ring_m[0], 0.42), (self.ring_m[1], 0.26),
                           (self.ring_m[0] + (self.ring_m[1] - self.ring_m[0]) * pulse, 0.35 * (1 - pulse))):
                rr = r_m / mpp0
                circ = np.stack([tx + rr * np.cos(ang), ty + rr * np.sin(ang)], axis=1)
                d.line(to_px(circ, s), fill=acc + (int(255 * a * ra),), width=max(1, int(round(2.2 * self.k * s))))
        # before the buildings stand up, the main one lights up flat — the first thing the eye finds
        pop = _smooth((t - tl["hit"]) / 0.14)
        grow = _smooth((t - tl["grow"][0]) / (tl["grow"][1] - tl["grow"][0]))
        if pop > 0 and grow < 1:
            shape = [r for r in (self.key["rings"] if self.key else [])]
            if not shape:
                # no building to light: a ring round the place
                tx, ty = self.dot
                rr = max(60.0, 0.14 * float(self.found["size_m"])) / m_per_px(self.lat, 0)
                ang = np.linspace(0, 2 * math.pi, 97)
                outer = np.stack([tx + rr * np.cos(ang), ty + rr * np.sin(ang)], axis=1)
                inner = np.stack([tx + 0.72 * rr * np.cos(ang), ty + 0.72 * rr * np.sin(ang)], axis=1)
                shape = [outer, inner]
            m = Image.new("L", (sc_w, sc_h), 0)
            dm = ImageDraw.Draw(m)
            dm.polygon(to_px(shape[0], s), fill=255)
            for inner in shape[1:]:
                dm.polygon(to_px(inner, s), fill=0)
            col = Image.new("RGBA", (sc_w, sc_h), acc + (255,))
            a = pop * (1 - grow) if self.key else pop
            col.putalpha(m.point(lambda p: int(p * a)))
            layer.alpha_composite(col)
            gm = Image.new("L", (self.w, self.h), 0)
            dgm = ImageDraw.Draw(gm)
            dgm.polygon(to_px(shape[0], 1), fill=int(230 * a))
            for inner in shape[1:]:
                dgm.polygon(to_px(inner, 1), fill=0)
            glow = Image.fromarray(np.maximum(np.asarray(glow), np.asarray(gm)))
        return layer, glow

    def _buildings(self, view: View, t: float, sc_w, sc_h, s, dim: float):
        tl = self.tl
        grow = _smooth((t - tl["grow"][0]) / (tl["grow"][1] - tl["grow"][0]))
        return self.blocks.draw(view, sc_w, sc_h, s, grow, dim)

    def frame(self, t: float) -> Image.Image:
        tl, k, s = self.tl, self.k, self.ss
        cam = camera(self.sc, tl, t)
        view = View(cam)
        g = render_ground(view, self.tiles, self.w, self.h, k)
        # the look: a touch of desaturation and weight; at the end everything but the place goes dark
        gray = (g[..., 0:1] * 0.299 + g[..., 1:2] * 0.587 + g[..., 2:3] * 0.114)
        g = gray + (g - gray) * 0.86
        dim = _smooth((t - tl["fill"][0]) / (tl["fill"][1] - tl["fill"][0]))
        if dim > 0:
            m = Image.new("L", (self.w, self.h), 0)
            dm = ImageDraw.Draw(m)
            if self.outline is not None:
                u, v, _, _, _ = view.project(self.outline[:, 0], self.outline[:, 1])
                dm.polygon(list(zip(((u + W / 2) * k).tolist(), ((v + H / 2) * k).tolist())), fill=255)
            else:
                tx, ty = self.dot
                rr = 0.3 * float(self.found["size_m"]) / m_per_px(self.lat, 0)
                ang = np.linspace(0, 2 * math.pi, 97)
                u, v, _, _, _ = view.project(tx + rr * np.cos(ang), ty + rr * np.sin(ang))
                dm.polygon(list(zip(((u + W / 2) * k).tolist(), ((v + H / 2) * k).tolist())), fill=255)
            inside = np.asarray(m.filter(ImageFilter.GaussianBlur(2.5 * k)), np.float32)[..., None] / 255.0
            out_f = dim * (1 - inside)
            g = gray + (g - gray) * (1 - 0.25 * out_f)
            g = g * (1 - 0.52 * out_f)
        img = Image.fromarray(np.clip(g, 0, 255).astype(np.uint8), "RGB").convert("RGBA")
        sw, sh = self.w * s, self.h * s
        if t >= tl["hit"]:
            flat, glow = self._flat(view, t, sw, sh, s)
            gl = np.asarray(glow.filter(ImageFilter.GaussianBlur(7 * k)), np.float32)[..., None] / 255.0
            if gl.max() > 0:
                base = np.asarray(img, np.float32)
                acc = np.array(self.accent + (255,), np.float32)
                base = base + (acc - base) * gl * 0.55
                base[..., 3] = 255
                img = Image.fromarray(np.clip(base, 0, 255).astype(np.uint8), "RGBA")
            img.alpha_composite(flat.resize((self.w, self.h), Image.BOX))
            bl = self._buildings(view, t, sw, sh, s, dim)
            if bl is not None:
                img.alpha_composite(bl.resize((self.w, self.h), Image.BOX))
        # the dot on the place, standing up to the camera
        if t >= tl["dot"]:
            a = _back((t - tl["dot"]) / 0.32)
            u, v, _, _, _ = view.project(np.array([self.dot[0]]), np.array([self.dot[1]]),
                                         self.dot_h / m_per_px(self.lat, view.z))
            half = int(40 * k) + 2                        # a small patch round the dot, drawn s times larger
            ox, oy = int(float(u[0]) * k + self.w / 2) - half, int(float(v[0]) * k + self.h / 2) - half
            cx, cy = ((float(u[0]) + W / 2) * k - ox) * s, ((float(v[0]) + H / 2) * k - oy) * s
            dl = Image.new("RGBA", (2 * half * s, 2 * half * s), (0, 0, 0, 0))
            dd = ImageDraw.Draw(dl)
            r_out, r_in = 15.5 * k * s * a, 11.0 * k * s * a
            if r_out > 0.5:
                dd.ellipse([cx - r_out - 2 * k * s, cy - r_out + 1 * k * s, cx + r_out + 2 * k * s,
                            cy + r_out + 5 * k * s], fill=(0, 0, 0, 90))
                dd.ellipse([cx - r_out, cy - r_out, cx + r_out, cy + r_out], fill=(255, 255, 255, 255))
                dd.ellipse([cx - r_in, cy - r_in, cx + r_in, cy + r_in], fill=self.accent + (255,))
                patch = dl.resize((2 * half, 2 * half), Image.BOX)
                if -2 * half < ox < self.w and -2 * half < oy < self.h:
                    full = Image.new("RGBA", img.size, (0, 0, 0, 0))
                    full.paste(patch, (ox, oy))
                    img.alpha_composite(full)
        # a zoom this fast smears a little, like a lens
        speed = abs(cam["dz"])
        if speed > 0.06:
            px_, py_ = PIN[0] * k, PIN[1] * k
            amt = min(0.022, 0.042 * (speed - 0.06))
            acc_img = np.asarray(img, np.float32)
            n = 3
            for i in range(1, n):
                sf = 1.0 / (1.0 + amt * i / (n - 1))
                sh_img = img.transform(img.size, Image.AFFINE, (sf, 0, px_ * (1 - sf), 0, sf, py_ * (1 - sf)),
                                       resample=Image.BILINEAR)
                acc_img = acc_img + np.asarray(sh_img, np.float32)
            img = Image.fromarray(np.clip(acc_img / n, 0, 255).astype(np.uint8), "RGBA")
        arr = np.asarray(img, np.float32)
        arr[..., :3] *= self.vig
        img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGBA")
        self.text.draw(img, t, tl)
        _credit(img, k)
        return img.convert("RGB")

    def prefetch(self, fps: int, log=print):
        need = set()
        n = int(round(float(self.sc["duration"]) * fps))
        for i in range(0, n, 2):
            view = View(camera(self.sc, self.tl, i / fps))
            need |= ground_needs(view, self.w, self.h, self.k)
        # the parents of every tile too, so a tile Esri lacks has something to stand in
        more = set()
        for (z, x, y) in need:
            while z > 0:
                z, x, y = z - 1, x // 2, y // 2
                if (z, x, y) in need or (z, x, y) in more:
                    break
                more.add((z, x, y))
        self.tiles.fetch(sorted(need | more), log=log)

    def sounds(self) -> list:
        """[(second, sound, gain dB)] — the scene's own sound marks (sfx.py plays them)."""
        tl = self.tl
        out = [(max(0.0, tl["d0"] - 0.05), "whoosh", -7.0), (tl["hit"], "riser", -12.0), (tl["hit"], "pop", -6.0),
               (tl["tilt"][0] + 0.15, "whoosh", -11.0), (tl["draw"][0], "tap", -14.0), (tl["dot"], "ping", -9.0)]
        k0, dt = tl["kicker"]
        for i, ch in enumerate(str(self.sc.get("kicker") or "")):
            if ch.strip():
                out.append((round(k0 + i * dt, 3), "typekey", -16.0))
        out += [(tl["title"], "hit", -6.0), (float(self.sc["duration"]), "whoosh_out", -11.0)]
        return [(round(a, 3), s_, g_) for a, s_, g_ in out]


def scene(found: dict, title: str, kicker: str = "", duration: float = DUR, hit: float = LEAD_S,
          accent: str = ACCENT, pitch: float = None, turn: float = TURN) -> dict:
    """A zoom scene as a small JSON-able dict (the place's buildings stay in the lookup cache)."""
    size = float(found["size_m"])
    p = pitch if pitch is not None else (PITCH if size < 6000 else 46.0 if size < 20000 else 36.0)
    pin = found.get("pin") or [found["lon"], found["lat"]]
    return {"shot": "zoom", "lon": float(pin[0]), "lat": float(pin[1]),
            "dot": [float(found["lon"]), float(found["lat"])],
            "z0": Z0, "z1": float(found["z1"]), "pitch": p, "turn": turn,
            "drift": DRIFT, "duration": round(float(duration), 3), "hit": round(float(hit), 3),
            "title": str(title or "").strip(), "kicker": str(kicker or "").strip(), "accent": accent}


def render(sc: dict, found: dict, out: Path, size=(W, H), fps: int = FPS, workers: int = 4, log=print) -> Path:
    """One zoom scene -> out (mp4), with out.sfx.json beside it for the sound design."""
    out = Path(out)
    t_start = time.time()
    S = Scene(sc, found, size)
    S.prefetch(fps, log=log)
    n = int(round(float(sc["duration"]) * fps))
    tmp = Path(tempfile.mkdtemp(prefix="satzoom_"))
    try:
        def one(i):
            S.frame(i / fps).save(tmp / f"f_{i:05d}.jpg", quality=93)
            return i
        with ThreadPoolExecutor(max_workers=max(1, workers)) as ex:
            list(ex.map(one, range(n)))
        out.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(["ffmpeg", "-y", "-framerate", str(fps), "-i", str(tmp / "f_%05d.jpg"),
                        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
                        "-color_range", "tv", "-r", str(fps), str(out)], check=True, capture_output=True)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    out.with_suffix(".sfx.json").write_text(json.dumps(S.sounds()), encoding="utf-8")
    log(f"  satzoom: {out.name} — {n} frames in {time.time() - t_start:.0f}s")
    return out


# ── CLI ─────────────────────────────────────────────────────────────────────────────────────────────────────
def _cli():
    import argparse
    ap = argparse.ArgumentParser(description="A dive from space onto one place, on satellite imagery.")
    ap.add_argument("cmd", choices=["show", "frames"])
    ap.add_argument("name")
    ap.add_argument("--names", nargs="*", default=[])
    ap.add_argument("--city", default="")
    ap.add_argument("--country", default="")
    ap.add_argument("--type", default="site")
    ap.add_argument("--lat", type=float)
    ap.add_argument("--lon", type=float)
    ap.add_argument("--title", default="")
    ap.add_argument("--kicker", default="")
    ap.add_argument("--accent", default=ACCENT)
    ap.add_argument("--duration", type=float, default=DUR)
    ap.add_argument("--hit", type=float, default=LEAD_S)
    ap.add_argument("--pitch", type=float)
    ap.add_argument("--turn", type=float, default=TURN)
    ap.add_argument("--size", default="1920x1080")
    ap.add_argument("--t", type=float, nargs="*", default=[1.5, 3.2, 4.5, 6.4])
    ap.add_argument("--out", default=str(HERE / "preview"))
    ap.add_argument("--workers", type=int, default=4)
    a = ap.parse_args()
    place = {"name": a.name, "names": a.names, "city": a.city, "country": a.country, "type": a.type}
    if a.lat is not None and a.lon is not None:
        place.update(lat=a.lat, lon=a.lon)
    found = find(place)
    if not found:
        sys.exit(f"could not find {a.name!r}")
    sc = scene(found, a.title or a.name, a.kicker, a.duration, a.hit, a.accent, a.pitch, a.turn)
    w, h = (int(x) for x in a.size.lower().split("x"))
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    slug = re.sub(r"[^a-z0-9]+", "_", a.name.lower()).strip("_")[:40]
    if a.cmd == "frames":
        S = Scene(sc, found, (w, h))
        S.prefetch(FPS)
        for t in a.t:
            p = out / f"satzoom_{slug}_{t:05.2f}.jpg"
            S.frame(t).save(p, quality=92)
            print(p)
    else:
        p = render(sc, found, out / f"satzoom_{slug}.mp4", (w, h), workers=a.workers)
        print(p)


if __name__ == "__main__":
    _cli()
