"""THE GUIDE PHOTO — a person cut out of a photo and laid on the right of the frame over some of the stock shots
(look.guide in a style file; the photo is picked or uploaded in Options, assets/guides/).

Everything here runs on this computer and costs nothing: the cut-out is a flood fill of the photo's plain backdrop
from its border (no background-remover API). A photo whose backdrop is not plain keeps its pixels and fades into
the shot on the left instead of being cut out.

look.guide (all optional):
  "every":   1 = every eligible stock shot, 2 = every other one (default 2)
  "min_s":   a shot shorter than this never carries the guide (default 3.0)
  "start_s": no guide before this second (default 4.0)
  "height":  the guide's height as a share of the frame (default 0.9), sitting on the bottom edge
  "margin":  pixels between the guide and the right edge (default 40; negative pushes it past the edge)
  "bottom":  pixels between the guide and the bottom edge (default 0; negative pushes it below the edge, so a
             photo with a sliver of empty space at its foot never shows a gap)
  "image":   the channel's default photo, a path under assets/ (Options can pick another per video)
"""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
DIR = HERE / "assets" / "guides"
EXT = {".png", ".jpg", ".jpeg", ".webp"}


def settings(info: dict) -> dict:
    g = (info or {}).get("look", {}).get("guide")
    if not g:
        return {}
    g = g if isinstance(g, dict) else {}
    return {"every": max(1, int(g.get("every") or 2)), "min_s": float(g.get("min_s") or 3.0),
            "start_s": float(g.get("start_s") if g.get("start_s") is not None else 4.0),
            "height": max(0.3, min(1.0, float(g.get("height") or 0.9))),
            "margin": int(g.get("margin") if g.get("margin") is not None else 40),
            "bottom": int(g.get("bottom") or 0),
            "image": str(g.get("image") or "")}


# ── the cut-out ───────────────────────────────────────────────────────────────

def _grow(seed, allowed):
    """Every `allowed` pixel 4-connected to `seed` (numpy only: dilate inside the mask until nothing changes)."""
    import numpy as np
    cur = seed & allowed
    while True:
        nxt = cur.copy()
        nxt[1:, :] |= cur[:-1, :]
        nxt[:-1, :] |= cur[1:, :]
        nxt[:, 1:] |= cur[:, :-1]
        nxt[:, :-1] |= cur[:, 1:]
        nxt &= allowed
        if (nxt == cur).all():
            return cur
        cur = nxt


def cutout(im, dest: Path) -> str:
    """Save `im` (a PIL image) as a transparent PNG of the person at `dest`. Returns how: "kept" (it already had
    transparency), "cut" (plain backdrop removed) or "fade" (busy backdrop: the photo fades out on its left)."""
    import numpy as np
    from PIL import Image, ImageFilter
    im = im.convert("RGBA")
    im.thumbnail((1600, 1600))
    a = np.asarray(im)
    if (a[:, :, 3] < 250).mean() > 0.02:                     # already a cut-out
        how, out = "kept", im
    else:
        small = im.convert("RGB")
        small.thumbnail((700, 700))
        rgb = np.asarray(small).astype(np.float32)
        h, w = rgb.shape[:2]
        b = 6
        border = np.concatenate([rgb[:b].reshape(-1, 3), rgb[-b:].reshape(-1, 3),
                                 rgb[:, :b].reshape(-1, 3), rgb[:, -b:].reshape(-1, 3)])
        bg = np.median(border, axis=0)
        border_d = np.linalg.norm(border - bg, axis=1)
        # the share of the border that is backdrop: a person cut off at the bottom edge is not backdrop,
        # so a plain studio photo still has most of its border near one colour
        plain = (border_d < 22).mean()
        if plain >= 0.55:
            dist = np.linalg.norm(rgb - bg, axis=2)
            tol = max(26.0, float(np.percentile(border_d[border_d < 22], 95)) * 2.5 + 8)
            allowed = dist < tol
            seed = np.zeros_like(allowed)
            seed[:b], seed[-b:], seed[:, :b], seed[:, -b:] = True, True, True, True
            back = _grow(seed, allowed)
            keep = Image.fromarray(np.where(back, 0, 255).astype(np.uint8)).resize(im.size, Image.BILINEAR)
            keep = keep.filter(ImageFilter.MinFilter(5)).filter(ImageFilter.GaussianBlur(1.2))   # no light fringe
            out = im.copy()
            out.putalpha(keep)
            how = "cut"
        else:
            # a busy backdrop: keep the photo, fade it into the shot on its left and along the bottom
            W, H = im.size
            x = np.linspace(0, 1, W)[None, :]
            y = np.linspace(0, 1, H)[:, None]
            alpha = np.clip(x / 0.45, 0, 1) * np.clip((1 - y) / 0.12, 0, 1) ** 0.5
            out = im.copy()
            out.putalpha(Image.fromarray((alpha * 255).astype(np.uint8)))
            how = "fade"
    box = out.getchannel("A").point(lambda v: 255 if v > 24 else 0).getbbox()
    if box:
        out = out.crop(box)
    dest.parent.mkdir(parents=True, exist_ok=True)
    out.save(dest, "PNG", optimize=True)
    return how


# ── where it shows ────────────────────────────────────────────────────────────

def _is_stock(job: Path, kind: str, path: str) -> bool:
    p = str(path).replace("\\", "/")
    if kind == "video":
        return "/pexels/" in p
    return kind == "photo" and "/stock_photos/" in p


def windows(plan: list, job: Path, cfg: dict) -> list:
    """[(start, end)] of the stock shots that carry the guide: full-frame stock clips and stock photos (never a
    graphic, a page, a framed shot), at least `min_s` long, every `every`-th one; touching windows are joined so
    the guide does not blink between two shots in a row."""
    try:
        framed = [tuple(x) for x in json.loads((job / "frame_mutes.json").read_text(encoding="utf-8"))]
    except (OSError, ValueError, TypeError):
        framed = []
    out, t, n = [], 0.0, 0
    for e in plan:
        kind, path, dur = str(e[0]), str(e[1]), float(e[3])
        a, b = t, t + dur
        t = b
        if not _is_stock(job, kind, path) or dur < cfg["min_s"] or a < cfg["start_s"]:
            continue
        if any(fa < b - 0.05 and fb > a + 0.05 for fa, fb in framed):
            continue
        n += 1
        if (n - 1) % cfg["every"]:
            continue
        if out and abs(out[-1][1] - a) < 0.05:
            out[-1] = (out[-1][0], b)
        else:
            out.append((a, b))
    return [(round(a, 3), round(b, 3)) for a, b in out]


def write_job(job: Path, image: Path, plan: list, cfg: dict, log=print) -> None:
    """job/guide.json for the final mux, or none at all when there is no photo or no shot for it."""
    f = job / "guide.json"
    f.unlink(missing_ok=True)
    if not cfg or image is None or not Path(image).is_file():
        return
    win = windows(plan, job, cfg)
    if not win:
        log("  guide: no stock shot long enough for the guide photo")
        return
    margin = cfg["margin"]
    try:
        # a photo cut off at its right side (an arm, a shoulder) sits flush on the frame edge, or the cut shows
        from PIL import Image
        with Image.open(image) as im:
            col = im.convert("RGBA").getchannel("A").crop((im.width - 2, 0, im.width, im.height))
            if margin > 0 and sum(1 for v in col.getdata() if v > 128) > 0.08 * col.width * col.height:
                margin = 0
    except OSError:
        pass
    f.write_text(json.dumps({"image": str(image), "windows": win, "height": cfg["height"],
                             "margin": margin, "bottom": cfg.get("bottom", 0)}, indent=1), encoding="utf-8")
    log(f"  guide: {Path(image).name} on {len(win)} stretch(es) of stock footage "
        f"({sum(b - a for a, b in win):.0f}s)")


def mux(job: Path):
    """What _final_mux needs: (png, windows, height share, margin) — or None."""
    try:
        d = json.loads((job / "guide.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    png = Path(str(d.get("image") or ""))
    win = [(float(a), float(b)) for a, b in d.get("windows") or []]
    if not png.is_file() or not win:
        return None
    margin = d.get("margin")
    return (png, win, float(d.get("height") or 0.9), int(40 if margin is None else margin),   # 0 is flush, not "unset"
            int(d.get("bottom") or 0))
