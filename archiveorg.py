#!/usr/bin/env python3
"""archiveorg.py — real footage from the Internet Archive (archive.org), free and without a key.

The Archive holds hundreds of thousands of films anyone may use: government and NASA films, newsreels, the
Prelinger collection, and everything an uploader marked public domain or CC. For a documentary this is the
footage YouTube cannot give: the real era, legally clear, and free to download.

    python archiveorg.py "chernobyl liquidators 1986"        # what a search finds
    python archiveorg.py "chernobyl liquidators" --get       # ...and download the best item's first minute

How it is used by the engine: `search()` returns candidates whose id starts with "ia:", and youtube.py takes
those ids everywhere it takes a YouTube id — yt-dlp downloads archive.org straight from the item page, so the
shot log, the picking and the cutting are the same code as for YouTube.

Only licences a monetised channel may use are kept: public domain, CC0, CC BY and CC BY-SA. Anything with
-nc (non-commercial) or -nd (no derivatives) is left out, and so is an item with no licence at all.
"""

import json
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

SEARCH = "https://archive.org/advancedsearch.php"
META = "https://archive.org/metadata"
DETAILS = "https://archive.org/details"
UA = {"User-Agent": "Frontier/1.0 (footage research)"}
# what a monetised channel may show: the free licences, never a -nc or -nd one
FREE = re.compile(r"(publicdomain|creativecommons\.org/publicdomain|/zero/|licenses/by/|licenses/by-sa/)", re.I)
UNFREE = re.compile(r"-nc|-nd|noncommercial|nonderiv", re.I)
# a television recording or a mirrored YouTube channel is not archive footage
SKIP_COLLECTIONS = ("tvarchive", "television", "podcasts", "mirrortube", "web")
# anyone may upload to the Archive, and a documentary channel cannot cut to a conspiracy reel or a hate
# tract whatever its licence says: these are dropped on sight
JUNK = re.compile(r"\bzog\b|zionist occupied|jewish world|white genocide|holohoax|holocaust (hoax|lie)|qanon|"
                  r"chemtrail|flat earth|new world order|illuminati|deep state|crisis actor|false flag|"
                  r"plandemic|great reset|adrenochrome|anti[- ]?vax|\bnazis?\b(?!.*\b(19[34]\d|newsreel|archive)\b)|"
                  r"germ warfare in korea|\bexposed\b|the truth about|wake up|they don.?t want you", re.I)
# an upload that is someone talking, not film of anything: the word in its description means nothing
TALK = re.compile(r"podcast|radio show|talk show|sermon|lecture|webinar|audiobook|full album|episode\s*\d|"
                  r"\bc4i\b|interview with|conference call|hearing on|testimony", re.I)
PLAYABLE = ("h.264", "h.264 ia", "mpeg4", "512kb mpeg4", "hi-res mpeg4", "mp4", "matroska", "ogg video")


def _get(url: str, timeout: float = 45.0):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def _num(x, default=0.0) -> float:
    try:
        return float(str(x).strip())
    except (TypeError, ValueError):
        return default


def free_licence(url: str) -> bool:
    url = str(url or "")
    return bool(FREE.search(url)) and not UNFREE.search(url)


# collections whose films really are public domain: the US government's own and the Archive's own libraries.
# Everywhere else the licence is what an uploader typed in, so it is worth less — those items come second.
TRUSTED = ("prelinger", "fedflix", "usgovfilms", "nasa", "gov.archives", "nationalarchives", "library_of_congress",
           "defenseimagery", "dod", "nist", "noaa", "usnationalarchives", "computerchronicles")


def _words(query: str) -> list:
    """The words of a query that carry meaning — the Archive matches on those, not on "footage" or "the"."""
    return [w for w in re.findall(r"[\w\u0400-\u04FF']{3,}", query) if w.lower() not in
            ("the", "and", "for", "with", "from", "footage", "archive", "video", "documentary", "shot",
             "clip", "scene", "real", "shots", "close", "wide")]


def _variants(query: str) -> list:
    """The Archive's search is AND by default, so a long query finds nothing: it is asked three ways —
    the whole phrase, every word, and the two or three words that carry the meaning."""
    words = [w for w in re.findall(r"[\w\u0400-\u04FF']{3,}", query) if w.lower() not in
             ("the", "and", "for", "with", "from", "footage", "archive", "video", "documentary", "shot")]
    core = sorted(words, key=len, reverse=True)[:3]
    # the title first: a film whose title says "Chernobyl" is about Chernobyl, while the description of a
    # podcast merely mentions it
    out = [f'title:({" AND ".join(core[:2])})'] if len(core) > 1 else []
    if core:
        out.append(f"title:({core[0]})")
    out += [f'"{query.strip()}"'] if len(words) > 1 else []
    if words:
        out.append(" AND ".join(words))
    if core and len(core) < len(words):
        out.append(" AND ".join(core))
    if len(core) > 2:
        out.append(" AND ".join(core[:2]))
    return out or [query]


def search(query: str, n: int = 12, rows: int = 40, free_only: bool = True, must: list = None) -> list:
    """[{id, identifier, title, year, licence, page, downloads, trusted}] — the Archive's films for a plain
    English query, the ones a monetised channel may actually show.

    The Archive searches descriptions, so a query pulls in talk shows and mirrored YouTube channels too: the
    television collections and the youtube-* mirrors are left out here, government and Prelinger films come
    first, and the rest is ranked by how often an item has been downloaded."""
    fl = ("identifier", "title", "year", "date", "licenseurl", "downloads", "collection", "description")
    # the query is asked three ways and the last way keeps only two of its words, so "Chernobyl control room"
    # can come back as a film about a temple: an item counts only when the words are in its own title or
    # description, and the more of them it has the higher it ranks
    words = _words(query)
    core = list(must) if must is not None else sorted(words, key=len, reverse=True)[:2]
    out, seen = [], set()
    for variant in _variants(query):
        q = (f'({variant}) AND mediatype:(movies) AND NOT identifier:(youtube-*) '
             + " ".join(f"AND NOT collection:({c})" for c in SKIP_COLLECTIONS))
        if free_only:
            q += " AND licenseurl:(*publicdomain* OR *creativecommons*)"
        p = {"q": q, "rows": rows, "page": 1, "output": "json", "sort[]": "downloads desc"}
        url = f"{SEARCH}?" + urllib.parse.urlencode(p) + "".join(f"&fl[]={x}" for x in fl)
        try:
            docs = _get(url)["response"]["docs"]
        except Exception:                                      # noqa: BLE001 - a search is never worth the video
            continue
        for d in docs:
            ident = str(d.get("identifier") or "")
            lic = str(d.get("licenseurl") or "")
            if not ident or ident in seen or (free_only and not free_licence(lic)):
                continue
            head = str(d.get("title") or "").lower()
            hay = f"{head} {d.get('description') or ''}".lower()
            if JUNK.search(hay[:600]) or TALK.search(hay[:400]) or (core and not any(w.lower() in hay for w in core)):
                continue
            # a word in the title is the real thing; a word only in the description is a second choice
            tier = 0 if any(w.lower() in head for w in core) else 1
            seen.add(ident)
            cols = d.get("collection") or []
            cols = [cols] if isinstance(cols, str) else list(cols)
            out.append({"id": f"ia:{ident}", "identifier": ident, "title": str(d.get("title") or "")[:120],
                        "year": str(d.get("year") or d.get("date") or "")[:10], "licence": lic,
                        "page": f"{DETAILS}/{ident}", "downloads": int(_num(d.get("downloads"))),
                        "hits": sum(1 for w in words if w.lower() in hay), "tier": tier,
                        "trusted": any(c.lower() in TRUSTED for c in cols)})
        if len(out) >= n * 3:
            break
    out.sort(key=lambda c: (c["tier"], -c["hits"], not c["trusted"], -c["downloads"]))
    return out[:n]


def details(identifier: str, min_height: int = 480, max_seconds: float = 5400.0) -> dict:
    """{file, height, width, seconds, size_mb, credit, licence} of the best playable file, or {} when the item
    is unusable (too small a picture, no video file, longer than the caller wants to watch)."""
    ident = identifier.split(":", 1)[-1]
    try:
        d = _get(f"{META}/{ident}")
    except Exception:                                          # noqa: BLE001
        return {}
    m = d.get("metadata") or {}
    best = {}
    for f in d.get("files") or []:
        fmt = str(f.get("format") or "").lower()
        name = str(f.get("name") or "")
        if fmt not in PLAYABLE and not name.lower().endswith((".mp4", ".mkv", ".ogv")):
            continue
        h, w = int(_num(f.get("height"))), int(_num(f.get("width")))
        secs, size = _num(f.get("length")), _num(f.get("size")) / 1e6
        if h and h < min_height:
            continue
        if secs and secs > max_seconds:
            continue
        if not best or (h, size) > (best["height"], best["size_mb"]):
            best = {"file": name, "height": h, "width": w, "seconds": secs, "size_mb": round(size, 1)}
    if not best:
        return {}
    best["id"] = f"ia:{ident}/{best['file']}"
    who = str(m.get("creator") or m.get("uploader") or "").split("@")[0][:60]
    best.update({"identifier": ident, "title": str(m.get("title") or "")[:120], "licence": str(m.get("licenseurl") or ""),
                 "page": f"{DETAILS}/{ident}", "year": str(m.get("year") or m.get("date") or "")[:10],
                 "credit": f"Internet Archive — {str(m.get('title') or ident)[:70]}" + (f" ({who})" if who else "")})
    return best


def candidates(query: str, n: int = 4, min_height: int = 480, max_seconds: float = 5400.0,
               free_only: bool = True, skip: set = (), must: list = None) -> list:
    """The items worth watching for a query: searched, then checked for a picture big enough to cut from."""
    out = []
    for c in search(query, n=n * 4, free_only=free_only, must=must):
        if c["identifier"] in (skip or ()):
            continue
        got = details(c["identifier"], min_height, max_seconds)
        if not got:
            continue
        got["page"] = c["page"]
        out.append(dict(c, **got))
        if len(out) >= n:
            break
    return out


def watch_url(vid: str) -> str:
    """What yt-dlp is pointed at for an "ia:" id: the file itself when the id names one (an item can hold a
    hundred films), else the item page. youtube.py hands every other id to YouTube."""
    rest = str(vid).split(":", 1)[-1]
    if "/" in rest:
        ident, name = rest.split("/", 1)
        return f"https://archive.org/download/{ident}/{urllib.parse.quote(name)}"
    return f"{DETAILS}/{rest}"


def _cli() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        print(__doc__)
        return
    query = " ".join(args)
    got = candidates(query, n=6)
    for c in got:
        print(f"{c['id']:<46} {c['height']:>5}p {c['seconds'] / 60:>6.1f} min  {c['licence'][-28:]:28s} {c['title'][:60]}")
    if "--get" in sys.argv and got:
        import subprocess
        dest = Path(f"{got[0]['identifier'][:40]}.mp4")
        subprocess.run(["yt-dlp", "-q", "--no-warnings", "-f", "bv*[height<=1080]+ba/b",
                        "--download-sections", "*0-60", "--force-keyframes-at-cuts",
                        "-o", str(dest.with_suffix("")) + ".%(ext)s", watch_url(got[0]["id"])], check=False)
        print("downloaded", dest if dest.exists() else "(nothing)")


if __name__ == "__main__":
    _cli()
