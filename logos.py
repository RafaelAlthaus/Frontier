"""logos.py — the official logo of any company the news names.

WHY THIS IS NOT A FOLDER OF PNGs
--------------------------------
An AI-news channel names a different set of companies every week, and half of
them did not exist last year. A shipped pack of twenty logos is out of date by
the third video. So a logo is looked up the first time it is spoken and cached
from then on: `fetch("Moonshot AI")` works on the day Moonshot launches.

WHERE THEY COME FROM
--------------------
Wikipedia's article for the company, whose infobox carries the logo the company
itself uses — as SVG where one exists, which is why these stay sharp at 1920.
A company logo is a trademark, not a free image: this is the same editorial use
a news programme makes when it reports on the company, so the logo is only ever
drawn next to a statement about that company, never as a badge on the channel.

ALIASES exists because the obvious search term is often the wrong article —
"Grok" is a chatbot with its own page and its own mark — the parent's page now answers SpaceXAI;
"Qwen" redirects to a model family whose page carries no logo, while Alibaba
Cloud's does. Those are judgements, so they are written down rather than
guessed at run time.

LIGHT AND DARK
--------------
Most official marks are black on transparent, which is invisible on this
channel's near-black ground. `fetch(..., on="dark")` measures the ink of the
mark and returns a white version when it would otherwise disappear — the shape
is the trademark, the colour of a monochrome wordmark is not. A logo with real
brand colour in it (Google, Meta, Alibaba's orange) is left exactly as it is.
"""

import base64
import json
import os
import re
import shutil
import threading
import time
import urllib.parse
from pathlib import Path

import requests

HERE = Path(__file__).resolve().parent
STORE = HERE / "assets" / "logos"
INDEX = STORE / "index.json"
WIDTH = 1400                      # cached at this width: big enough for a full-frame wordmark
UA = {"User-Agent": "Frontier/5 (offline video tool; contact: via Whop)"}
API = "https://en.wikipedia.org/w/api.php"
_LOCK = threading.Lock()
_PAUSE = 1.1                      # Wikipedia answers 429 to a burst; this is politeness, not a retry


# The name a script says -> the article that carries the mark people recognise.
# "hint" picks between several files on one page; "keep" means the mark has real
# brand colour and must never be recoloured for a dark ground.
ALIASES = {
    "openai":      {"page": "OpenAI", "hint": "wordmark"},
    "chatgpt":     {"page": "OpenAI", "hint": "wordmark"},
    "gpt":         {"page": "OpenAI", "hint": "wordmark"},
    "anthropic":   {"page": "Anthropic", "hint": "anthropic logo"},
    "claude":      {"page": "Anthropic", "hint": "claude"},
    "xai":         {"page": "SpaceXAI", "hint": "spacexai"},
    "x.ai":        {"page": "SpaceXAI", "hint": "spacexai"},
    # Grok now carries its own current mark; pointing it at the parent returned the
    # SPACEX wordmark, which says nothing to someone watching a story about Grok.
    "grok":        {"page": "Grok (chatbot)", "hint": "grok"},
    "spacexai":    {"page": "SpaceXAI", "hint": "spacexai"},
    "google":      {"page": "Google", "hint": "google", "keep": True},
    "gemini":      {"page": "Google Gemini", "hint": "gemini", "keep": True},
    "deepmind":    {"page": "Google DeepMind", "hint": "deepmind"},
    "meta":        {"page": "Meta Platforms", "hint": "meta platforms", "keep": True},
    "llama":       {"page": "Meta Platforms", "hint": "meta platforms", "keep": True},
    "microsoft":   {"page": "Microsoft", "hint": "microsoft", "keep": True},
    "copilot":     {"page": "Microsoft Copilot", "hint": "copilot", "keep": True},
    "alibaba":     {"page": "Alibaba Group", "hint": "alibaba", "keep": True},
    "qwen":        {"page": "Qwen", "hint": "qwen", "keep": True},
    "perplexity":  {"page": "Perplexity AI", "hint": "perplexity"},
    "nvidia":      {"page": "Nvidia", "hint": "nvidia", "keep": True},
    "deepseek":    {"page": "DeepSeek", "hint": "deepseek", "keep": True},
    "mistral":     {"page": "Mistral AI", "hint": "mistral", "keep": True},
    "apple":       {"page": "Apple Inc.", "hint": "apple logo"},
    "amazon":      {"page": "Amazon (company)", "hint": "amazon logo", "keep": True},
    "aws":         {"page": "Amazon Web Services", "hint": "aws", "keep": True},
    "tesla":       {"page": "Tesla, Inc.", "hint": "tesla"},
    "midjourney":  {"page": "Midjourney", "hint": "midjourney"},
    "stability":   {"page": "Stability AI", "hint": "stability"},
    "hugging face": {"page": "Hugging Face", "hint": "hugging face", "keep": True},
    "runway":      {"page": "Runway (company)", "hint": "runway"},
    "figma":       {"page": "Figma", "hint": "figma", "keep": True},
    "notion":      {"page": "Notion (productivity software)", "hint": "notion"},
    "slack":       {"page": "Slack (software)", "hint": "slack", "keep": True},
    "github":      {"page": "GitHub", "hint": "github"},
    "cursor":      {"page": "Cursor (code editor)", "hint": "cursor"},
    "ibm":         {"page": "IBM", "hint": "ibm"},
    "samsung":     {"page": "Samsung", "hint": "samsung"},
    "bytedance":   {"page": "ByteDance", "hint": "bytedance"},
    "tiktok":      {"page": "TikTok", "hint": "tiktok", "keep": True},
    "baidu":       {"page": "Baidu", "hint": "baidu", "keep": True},
    "tencent":     {"page": "Tencent", "hint": "tencent"},
    "moonshot":    {"page": "Moonshot AI", "hint": "moonshot"},
    "cohere":      {"page": "Cohere", "hint": "cohere"},
    "salesforce":  {"page": "Salesforce", "hint": "salesforce", "keep": True},
    "adobe":       {"page": "Adobe Inc.", "hint": "adobe", "keep": True},
    "spotify":     {"page": "Spotify", "hint": "spotify", "keep": True},
    "netflix":     {"page": "Netflix", "hint": "netflix", "keep": True},
    # the UN's page scored the US flag first ("united" in its file name): the emblem is the mark
    "united nations": {"page": "United Nations", "file": "File:Emblem of the United Nations.svg"},
    "un security council": {"page": "United Nations", "file": "File:Emblem of the United Nations.svg"},
    "security council": {"page": "United Nations", "file": "File:Emblem of the United Nations.svg"},
}

# Wikipedia hangs these on nearly every article; none of them is a company mark.
JUNK = ("commons-logo", "symbol ", "wikidata", "wiktionary", "edit-", "ambox",
        "question_book", "folder_hexagonal", "wikiquote", "wikisource", "padlock",
        "office-book", "text_document", "increase2", "decrease2", "red_pog",
        "blue_pencil", "crystal", "portal", "flag_of", "emblem_of")


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(name or "").strip().lower()).strip("-") or "logo"


def _key(name: str) -> str:
    return re.sub(r"\s+", " ", str(name or "").strip().lower())


def _index() -> dict:
    try:
        return json.loads(INDEX.read_text(encoding="utf-8"))
    except Exception:                                      # noqa: BLE001 - a missing or half-written index is just empty
        return {}


def _save_index(ix: dict) -> None:
    STORE.mkdir(parents=True, exist_ok=True)
    tmp = INDEX.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(ix, indent=1, ensure_ascii=False), encoding="utf-8")
    tmp.replace(INDEX)


def _api(params: dict) -> dict:
    """One Wikipedia call, spaced out. A 429 here is the whole lookup failing, and
    the next video would re-ask for the same logo, so we wait rather than hammer."""
    params = {"format": "json", "formatversion": "2", "redirects": "1", **params}
    for attempt in range(3):
        with _LOCK:
            time.sleep(_PAUSE)
        r = requests.get(API, params=params, headers=UA, timeout=25)
        if r.status_code == 429:
            time.sleep(2.0 * (attempt + 1))
            continue
        r.raise_for_status()
        return r.json()
    raise RuntimeError("wikipedia: rate limited")


def _alias(name: str) -> dict:
    """The curated entry for a name, matched loosely: a script says "Google Gemini",
    "Gemini 3.8" or "OpenAI's GPT-6", and all three mean the entry keyed "gemini"
    or "openai". Longest key first, so "hugging face" beats nothing and "claude"
    is not shadowed by a shorter key that happens to appear inside it."""
    k = _key(name)
    if k in ALIASES:
        return ALIASES[k]
    words = set(re.findall(r"[a-z.]+", k))
    hits = [key for key in ALIASES
            if key in words or (" " in key and key in k)]
    if not hits:
        return {}
    # The head of a product name is its LAST word, so "Google Gemini" is a Gemini
    # thing and "Microsoft Copilot" a Copilot one. Ranking by length alone made
    # both of those resolve to the parent company and fetch the wrong mark.
    hits.sort(key=lambda key: (k.rfind(key), len(key)), reverse=True)
    return ALIASES[hits[0]]


def _resolve_page(name: str) -> str:
    """The article to read the mark off. A curated page wins; otherwise search."""
    a = _alias(name)
    if a:
        return a["page"]
    d = _api({"action": "query", "list": "search", "srsearch": f"{name} company", "srlimit": 3})
    hits = ((d.get("query") or {}).get("search") or [])
    return hits[0]["title"] if hits else str(name)


def _pick_file(page: str, hint: str, name: str) -> str:
    """The File: on that article most likely to be the company's mark."""
    d = _api({"action": "query", "prop": "images", "imlimit": "80", "titles": page})
    pages = (d.get("query") or {}).get("pages") or []
    files = [i["title"] for p in pages for i in (p.get("images") or [])]
    files = [f for f in files if not any(j in f.lower() for j in JUNK)]
    if not files:
        return ""

    def score(f: str) -> tuple:
        low = f.lower()
        s = 0
        if hint and hint.lower() in low:
            s += 10
        if _key(name).split()[0] in low:
            s += 6
        if "logo" in low or "wordmark" in low:
            s += 5
        if low.endswith(".svg"):
            s += 4                      # vector: still sharp filling the frame
        if "wordmark" in low:
            s += 2                      # the name spelled out reads better than a bare glyph
        if "icon" in low or "favicon" in low:
            s -= 2
        if "flag of" in low.replace("_", " ") and "flag" not in _key(name):
            s -= 12                     # a country's flag hangs on half the articles; it is nobody's logo
        # the newest mark on the page: a company's article keeps every past logo,
        # and Gemini's page still carries the Bard wordmark it replaced
        yrs = [int(y) for y in re.findall(r"(19\d{2}|20\d{2})", f)]
        if yrs:
            s += 3 + min(3, max(0, (max(yrs) - 2015)) // 3)
        return (s, max(yrs) if yrs else 0, -len(f))
    files.sort(key=score, reverse=True)
    return files[0] if score(files[0])[0] > 0 else ""


def _file_url(file_title: str) -> str:
    d = _api({"action": "query", "prop": "imageinfo", "iiprop": "url", "titles": file_title})
    pages = (d.get("query") or {}).get("pages") or []
    for p in pages:
        for ii in (p.get("imageinfo") or []):
            return ii.get("url") or ""
    return ""


def _svg_to_png(svg: bytes, dest: Path, width: int = WIDTH) -> bool:
    """Rasterise through the Chromium that is already a dependency, on transparency.
    The SVG is sized by the page rather than trusted: many marks declare a tiny
    viewport (or none) and would come back 24px wide and unusable."""
    try:
        from playwright.sync_api import sync_playwright
    except Exception:                                      # noqa: BLE001
        return False
    b64 = base64.b64encode(svg).decode()
    html = ("<!doctype html><html><head><style>html,body{margin:0;background:transparent}"
            f"img{{display:block;width:{width}px;height:auto}}</style></head>"
            f'<body><img id="m" src="data:image/svg+xml;base64,{b64}"></body></html>')
    try:
        with sync_playwright() as pw:
            b = pw.chromium.launch(args=["--force-color-profile=srgb", "--disable-gpu"])
            pg = b.new_page(viewport={"width": width, "height": 400}, device_scale_factor=1)
            pg.set_content(html, wait_until="load")
            pg.wait_for_function("document.getElementById('m').complete && "
                                 "document.getElementById('m').naturalWidth>0", timeout=20000)
            box = pg.evaluate("()=>{const r=document.getElementById('m').getBoundingClientRect();"
                              "return {w:Math.ceil(r.width),h:Math.ceil(r.height)}}")
            h = max(1, min(int(box["h"]), 2000))
            pg.set_viewport_size({"width": width, "height": h})
            pg.screenshot(path=str(dest), omit_background=True,
                          clip={"x": 0, "y": 0, "width": width, "height": h})
            b.close()
        return dest.exists() and dest.stat().st_size > 400
    except Exception:                                      # noqa: BLE001 - a logo is never worth failing a render for
        return False


def _trim_and_measure(png: Path, keep_colour: bool) -> dict:
    """Crop the transparent margin away and say whether the mark is monochrome ink.
    Without the crop, a mark with a wide built-in margin lands tiny in the frame."""
    from PIL import Image
    im = Image.open(png).convert("RGBA")
    bb = im.getbbox()
    if bb:
        im = im.crop(bb)
    if im.width > WIDTH:
        im = im.resize((WIDTH, max(1, round(im.height * WIDTH / im.width))), Image.LANCZOS)
    im.save(png)

    px = im.getdata()
    lum, sat, n = 0.0, 0.0, 0
    for r, g, b, a in px:
        if a < 40:
            continue
        n += 1
        lum += 0.299 * r + 0.587 * g + 0.114 * b
        sat += max(r, g, b) - min(r, g, b)
    if not n:
        return {"w": im.width, "h": im.height, "mono": False, "dark": False}
    mono = (sat / n) < 26 and not keep_colour          # grey ink, no brand colour to protect
    return {"w": im.width, "h": im.height, "mono": mono, "dark": (lum / n) < 135}


def _recolour(src: Path, dest: Path, rgb=(255, 255, 255)) -> Path:
    """Same shape, new ink — for a black wordmark on a black ground. Only ever
    called on a mark measured as monochrome, so no brand colour is destroyed."""
    from PIL import Image
    im = Image.open(src).convert("RGBA")
    a = im.getchannel("A")
    out = Image.new("RGBA", im.size, rgb + (0,))
    out.putalpha(a)
    out.save(dest)
    return dest


def _ondark(src: Path, dest: Path) -> bool:
    """A coloured mark made readable on a dark ground WITHOUT touching its colour.

    A mark with brand colour is never recoloured — but many carry their colour in one
    element and set the name in dark grey (Gemini's star and its grey wordmark), and
    that grey vanishes on near-black. Here only the dark NEUTRAL ink turns white; every
    pixel with real colour stays exactly as the company drew it. Returns False when the
    mark has too little dark neutral ink to be worth a second file."""
    from PIL import Image
    import colorsys
    im = Image.open(src).convert("RGBA")
    px = im.load()
    w, h = im.size
    changed = total = 0
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 20:
                continue
            total += 1
            hh, ss, vv = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            # dark grey-to-black ink only: at .62 the grey middle of Gemini's gradient star
            # turned into a white fleck. Anti-aliased letter edges are black with partial
            # alpha, so they still lift cleanly at this threshold.
            if ss < 0.15 and vv < 0.45:
                lift = 1.0 - vv                            # the darker it was, the whiter it goes
                c = int(255 * min(1.0, vv + lift))
                px[x, y] = (c, c, c, a)
                changed += 1
    if not total or changed / total < 0.08:
        return False
    im.save(dest)
    return True


def fetch(name: str, on: str = "dark", force: bool = False, log=print) -> Path:
    """The company's official logo as a trimmed PNG with transparency, cached.

    `on` is the ground it will sit on: a monochrome mark that would vanish there
    is recoloured (black wordmark on "dark" -> white). Returns None when the
    company has no usable mark — the caller draws the name as type instead, which
    is what a news programme does for a company with no logo on file."""
    key, slug = _key(name), _slug(name)
    STORE.mkdir(parents=True, exist_ok=True)
    base, white = STORE / f"{slug}.png", STORE / f"{slug}-white.png"
    ix = _index()
    rec = ix.get(key)

    if force or not rec or not base.exists():
        a = _alias(name)
        try:
            page = _resolve_page(name)
            # an entry may name the file itself when the article buries it under a hundred others
            ft = a.get("file") or _pick_file(page, a.get("hint") or "", name)
        except Exception as e:                             # noqa: BLE001
            # Wikipedia rate-limiting us is not the same as the company having no
            # logo. Caching it as a miss meant three companies in a row were
            # written off for good because they happened to be looked up last.
            log(f"  logo: {name} — lookup unavailable ({str(e)[:60]}), will retry next time")
            return None
        if not ft:
            log(f"  logo: nothing usable on '{page}' for {name}")
            ix[key] = {"miss": True, "page": page}
            _save_index(ix)
            return None
        url = _file_url(ft)
        if not url:
            return None
        try:
            r = requests.get(url, headers=UA, timeout=30)
            r.raise_for_status()
            raw = r.content
        except Exception as e:                             # noqa: BLE001
            log(f"  logo: {name} — download failed ({str(e)[:80]})")
            return None
        # by content, not by URL: Wikimedia serves SVGs from paths that do not
        # always end in .svg, and an SVG written to a .png is a file nothing opens
        if b"<svg" in raw[:2048].lower():
            if not _svg_to_png(raw, base):
                return None
        else:
            base.write_bytes(raw)
        meta = _trim_and_measure(base, keep_colour=bool(a.get("keep")))
        rec = {"page": page, "file": ft, "url": url, **meta}
        if meta["mono"]:
            _recolour(base, white)
        ix[key] = rec
        _save_index(ix)
        log(f"  logo: {name} -> {ft} ({meta['w']}x{meta['h']}"
            f"{', mono' if meta['mono'] else ''})")

    if rec.get("miss"):
        return None
    if on == "dark" and rec.get("mono") and rec.get("dark") and white.exists():
        return white
    if on == "dark" and not rec.get("mono") and base.exists():
        # a coloured mark with dark grey lettering: its name lifted to white, its colour kept
        od = base.with_name(base.stem + "_ondark.png")
        if od.exists() or (not rec.get("no_ondark") and _ondark(base, od)):
            return od
        if not od.exists() and not rec.get("no_ondark"):
            rec["no_ondark"] = True
            ix = _index(); ix[_key(name)] = rec; _save_index(ix)
    return base if base.exists() else None


def data_uri(name: str, on: str = "dark") -> str:
    """The logo as a data: URI for a kit scene, or "" — a scene must never break
    because a company had no mark."""
    try:
        p = fetch(name, on=on, log=lambda *_: None)
    except Exception:                                      # noqa: BLE001
        return ""
    if not p or not p.exists():
        return ""
    return "data:image/png;base64," + base64.b64encode(p.read_bytes()).decode()


def _cli(argv: list) -> int:
    cmd = (argv[1] if len(argv) > 1 else "").lower()
    if cmd == "get" and len(argv) > 2:
        for nm in argv[2:]:
            p = fetch(nm, force=("--force" in argv))
            print(f"{nm:18s} -> {p if p else 'no logo found'}")
        return 0
    if cmd == "check":
        names = argv[2:] or ["OpenAI", "Anthropic", "xAI", "Google Gemini", "Meta",
                             "Microsoft", "Alibaba", "Perplexity", "Nvidia", "DeepSeek"]
        bad = 0
        for nm in names:
            p = fetch(nm)
            ok = bool(p and p.exists())
            bad += 0 if ok else 1
            print(("  ok  " if ok else "  --  ") + nm + (f"  {p.name}" if ok else ""))
        print(f"\n{len(names) - bad}/{len(names)} found")
        return 1 if bad == len(names) else 0
    if cmd == "clear":
        shutil.rmtree(STORE, ignore_errors=True)
        print("logo cache cleared")
        return 0
    print(__doc__.strip().splitlines()[0])
    print("\n  python logos.py get OpenAI Anthropic [--force]")
    print("  python logos.py check")
    print("  python logos.py clear")
    return 0


if __name__ == "__main__":
    import sys
    raise SystemExit(_cli(sys.argv))
