#!/usr/bin/env python3
"""widen.py — a photo that is too narrow for the frame, extended to 16:9.

A press photo of a person is usually a portrait, 3:4 or 2:3. Laid into a 16:9 frame it
either leaves black bars down both sides or is blown up until the face fills the shot
and the forehead leaves it. The SNAP scene needs the person standing in a wide frame
with room to push right, so the photo is extended instead: an image model paints the
missing sides as a continuation of the real background (the same wall, the same light).

The person is never repainted. Only the new sides come from the model; the original
photo is laid back over the middle, pixel for pixel, with a soft edge so the seam does
not show. What the viewer sees of the person is exactly the real photograph.

    widen(photo, folder)            -> the 16:9 JPEG (the photo itself if it is wide enough)
    widen_cutout(cut, photo, wide)  -> the person's cutout on the same 16:9 geometry

    python widen.py photo.jpg [out_folder]
"""
import hashlib
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
RATIO = 16 / 9
OUT_W, OUT_H = 1920, 1080

# Siray draws 1536x1024 and make_video crops the middle 1536x864 band to 16:9 — so the
# photo goes into exactly that band and the model fills everything around it.
CANVAS_W, CANVAS_H, BAND_H = 1536, 1024, 864
BAND_Y = (CANVAS_H - BAND_H) // 2

PROMPT = (
    "Extend this photograph outwards. The flat grey areas around it are empty canvas: fill ALL of them "
    "by continuing the real background of the photo — the same wall, surface, set or sky, the same light, "
    "colour, grain and depth of field — so the result reads as one continuous wide photograph taken with "
    "the same camera at the same moment. Keep everything inside the original photo exactly as it is. "
    "Do not add any people, faces, hands, text, letters, logos, microphones or new objects in the "
    "extended areas; they are background only. No borders, no frames, no vignette, no visible seam."
)


def _needs(im) -> bool:
    return im.width / im.height < RATIO - 0.02


def widen(photo, folder, log=print) -> Path:
    """The photo at 16:9: returned untouched when it is already wide enough, else extended
    at the sides by the image model with the real photo laid back over the middle. Cached
    by the photo's content, so the same picture is never paid for twice."""
    from PIL import Image, ImageFilter
    photo, folder = Path(photo), Path(folder)
    im = Image.open(photo).convert("RGB")
    if not _needs(im):
        return photo
    folder.mkdir(parents=True, exist_ok=True)
    key = hashlib.sha1(photo.read_bytes()).hexdigest()[:16]
    out = folder / f"wide_{key}.jpg"
    if out.exists():
        return out

    # 1. the canvas: the photo height-fit into the band the model's output will be cut to
    pw = round(im.width * BAND_H / im.height)
    canvas = Image.new("RGB", (CANVAS_W, CANVAS_H), (128, 128, 128))
    canvas.paste(im.resize((pw, BAND_H), Image.LANCZOS), ((CANVAS_W - pw) // 2, BAND_Y))
    cpath = folder / f"wide_{key}_canvas.png"
    canvas.save(cpath)

    # 2. the model paints the sides
    sys.path.insert(0, str(HERE))
    import make_video as mv
    import removebg
    ref = removebg.host(cpath)
    painted = folder / f"wide_{key}_painted.png"
    mv._siray_image_gen(PROMPT, painted, "widen", ref_urls=[ref])

    # 3. the real photo back over the middle, feathered, at the final size
    big = Image.open(painted).convert("RGB").resize((OUT_W, OUT_H), Image.LANCZOS)
    ow = round(im.width * OUT_H / im.height)
    orig = im.resize((ow, OUT_H), Image.LANCZOS)
    feather = max(8, ow // 40)
    mask = Image.new("L", (ow, OUT_H), 0)
    mask.paste(255, (feather, 0, ow - feather, OUT_H))          # hard in the middle, soft at the sides only
    mask = mask.filter(ImageFilter.GaussianBlur(feather / 2))
    x0 = (OUT_W - ow) // 2
    big.paste(orig, (x0, 0), mask)
    big.save(out, "JPEG", quality=93)
    cpath.unlink(missing_ok=True)
    log(f"  widen: {photo.name} {im.width}x{im.height} -> 16:9, sides painted, the person untouched")
    return out


def widen_cutout(cut, photo, wide, folder) -> Path:
    """The person's cutout moved onto the widened frame, so the SNAP burn lands on them to
    the pixel: the same height-fit and the same centring the photo was given."""
    from PIL import Image
    cut, photo, wide, folder = Path(cut), Path(photo), Path(wide), Path(folder)
    if wide == photo:
        return cut
    out = folder / f"{wide.stem}_cut.png"
    if out.exists():
        return out
    src = Image.open(photo)
    c = Image.open(cut).convert("RGBA")
    if c.size != src.size:                          # the remover may return a resized copy
        c = c.resize(src.size, Image.LANCZOS)
    ow = round(src.width * OUT_H / src.height)
    canvas = Image.new("RGBA", (OUT_W, OUT_H), (0, 0, 0, 0))
    canvas.paste(c.resize((ow, OUT_H), Image.LANCZOS), ((OUT_W - ow) // 2, 0))
    canvas.save(out)
    return out


if __name__ == "__main__":
    import os
    for line in (HERE / ".env").read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())
    if len(sys.argv) < 2:
        print(__doc__)
        raise SystemExit(0)
    src = Path(sys.argv[1])
    dst = Path(sys.argv[2]) if len(sys.argv) > 2 else src.parent
    print(widen(src, dst))
