#!/usr/bin/env python3
"""almanac_prep.py — turn an ALMANAC scene that names local media into a render-ready scene.

The kit page (assets/kits/almanac.js) cannot open files or run ffmpeg, so everything it needs is prepared here, once,
in Python. kits._with_props runs it for every ALMANAC scene; kits.generate runs it earlier with the job's own cache.

1. FOOTAGE. Any object under a key "footage" with "clips" (anywhere in the scene) —
       "footage": {"clips": [{"src": "youtube/clip_012.mp4", "in": 0, "out": 2.4, "edge": "CHICAGO · 1931"}, ...],
                   "fps": 15, "width": 960, "crop_y": 0.5}
   becomes the same object plus
       "frames": [JPEG paths, in order], "cuts": [first frame index of each clip], "n": total,
       "fps", "width", "height" (resolved), and per clip "n" (its frame count) and the resolved "in" / "out".
   Each clip is DEINTERLACED BEFORE ANY SCALING when it is interlaced (bwdif; "deint": true / false per clip or per
   footage forces it, "auto" (the default) asks ffmpeg's idet), then square-pixelled (SAR), resampled to `fps`,
   cover-scaled and cover-CROPPED to width x height (`aspect`, default 16:9) at `crop_y` / `crop_x` (0 = top / left,
   .5 = centre), and written as JPEG q 4. No grade: the page grades (almGrade), so all film shares one stock.
   Frames are cached by content (source size + mtime + every parameter), so a second run is free, and footage that
   already carries its frames is left as it is.
   Defaults per scene type: reel 15 fps / 960 px, tally 12 / 1280 (the bar is dollied at up to 2.4x),
   cardwall 15 / 1280, anything else 15 / 960.

2. CUT-OUTS. A PNG with real transparency — given as a plain path, or as {"src": path, ...} — gets its metadata:
       ar     width / height of the image (the layout formulas use w = h·ar)
       nat    [w, h] in pixels
       face   [cx, cy, fh] as fractions of the image (centre, height). By default a silhouette rule calibrated on
              macOS Vision (face centre = alpha top + 1.02 x head width, height = 1.13 x head width; 4-10 % off on
              head-and-shoulders cut-outs). On a Mac, a Vision face-box tool ($ALMANAC_FACEBOX, or tools/facebox next
              to this file) is asked first when it exists. It is OPTIONAL: without it (Windows, Linux, or no binary)
              the rule runs and nothing fails. face_src says which one answered.
       edges  the sides the photo was cut by its frame, a subset of "ltrb" (3 px border alpha mean > .12), and
       edge_alpha {l,t,r,b} the means themselves (a scene picks the side with more alpha when two qualify).
   A plain path becomes {"src": path, ...meta}; an object keeps its own values and only gains missing ones.
   Scenes read either form through core's almSrc() / almCut() / cutout(). Reserved keys (ground, palette,
   shutter, duration, seed) are never touched.
   trim_cutout() crops a background-removed photo to its figure first (photofx.cutout keeps the whole frame).

3. INLINING. inline_images() replaces every string that is a path to an existing local image (.png .jpg .jpeg
   .webp .gif), at any depth, INCLUDING inside lists (footage frames), with a data: URI.

Use:
    import almanac_prep
    sc = almanac_prep.prep_scene(scene_dict, base=job_dir, cache=job_dir / "motion" / "almanac", inline=True)
CLI:
    python almanac_prep.py scene.json out.json [--base DIR] [--cache DIR] [--inline]
Needs Pillow and numpy; ffmpeg / ffprobe from $FFMPEG_BIN / $FFPROBE_BIN or the PATH.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
IMG_EXT = (".png", ".jpg", ".jpeg", ".webp", ".gif")
RESERVED = {"ground", "palette", "shutter", "duration", "seed"}
TYPE_DEFAULTS = {"reel": (15, 960), "tally": (12, 1280), "cardwall": (15, 1280)}
DEFAULT_FPS, DEFAULT_WIDTH = 15, 960
# the plain-footage twin of core's almGrade (styles/almanac.json look.footage_grade carries the same chain)
GRADE_FF = ("hue=s=0,eq=contrast=1.14:brightness=0.02,colorlevels=romin=0.082:gomin=0.082:bomin=0.082:"
            "romax=0.957:gomax=0.945:bomax=0.941")


def _bin(name: str) -> str:
    return os.environ.get(f"{name.upper()}_BIN") or shutil.which(name) or name


FFMPEG, FFPROBE = _bin("ffmpeg"), _bin("ffprobe")


def default_cache() -> Path:
    """Where prepared frames and cut-out metadata live when no job folder is given (previews, checks)."""
    return Path(tempfile.gettempdir()) / "frontier_almanac_prep"


def _resolve(p: str, base: Path) -> Path:
    q = Path(str(p)).expanduser()
    return q if q.is_absolute() else (Path(base) / q)


# ── footage ──────────────────────────────────────────────────────────────────────────────────────
def _probe(src: Path) -> dict:
    r = subprocess.run([FFPROBE, "-v", "error", "-select_streams", "v:0", "-show_entries",
                        "stream=width,height,sample_aspect_ratio,field_order,r_frame_rate:format=duration",
                        "-of", "json", str(src)], capture_output=True, text=True, encoding="utf-8",
                       errors="replace", timeout=60)
    if r.returncode != 0:
        raise RuntimeError(f"almanac_prep: cannot read {src}: {r.stderr.strip()[:200]}")
    j = json.loads(r.stdout or "{}")
    st = (j.get("streams") or [{}])[0]
    sar = st.get("sample_aspect_ratio") or "1:1"
    try:
        a, b = (int(v) for v in sar.split(":"))
        sar_f = a / b if a and b else 1.0
    except ValueError:
        sar_f = 1.0
    return {"w": st.get("width"), "h": st.get("height"), "sar": sar_f,
            "field_order": st.get("field_order") or "unknown",
            "duration": float((j.get("format") or {}).get("duration") or 0.0)}


def _interlaced(src: Path, t_in: float, dur: float, info: dict) -> bool:
    """ffmpeg idet on (up to) 3 s of the clip: interlaced when TFF+BFF outweigh a quarter of the decided frames."""
    if info.get("field_order") in ("tt", "bb", "tb", "bt"):
        return True
    r = subprocess.run([FFMPEG, "-nostdin", "-hide_banner", "-ss", f"{t_in:.3f}", "-t", f"{min(3.0, max(0.2, dur)):.3f}",
                        "-i", str(src), "-an", "-vf", "idet", "-f", "null", "-"], capture_output=True, text=True,
                       encoding="utf-8", errors="replace", timeout=120)
    m = re.findall(r"Multi frame detection: TFF:\s*(\d+)\s*BFF:\s*(\d+)\s*Progressive:\s*(\d+)", r.stderr)
    if not m:
        return False
    tff, bff, prog = (int(v) for v in m[-1])
    return (tff + bff) > 0.25 * max(1, tff + bff + prog)


def _prepped(fo: dict) -> bool:
    """Footage that already carries its frame list (a second pass, or a job whose scene was prepped earlier)."""
    frames = fo.get("frames") or []
    if not frames:
        return False
    if not fo.get("clips"):
        return True
    return fo.get("n") == len(frames) and all(str(f).startswith("data:") or Path(str(f)).exists() for f in frames)


def prep_footage(fo, base: Path, cache: Path, kind: str = "") -> dict:
    """fo = {"clips": [...], "fps", "width", "aspect", "crop_y", "crop_x", "deint"} → the same + frames/cuts."""
    if isinstance(fo, list):                                   # the short form: a bare list of clips
        fo = {"clips": fo}
    fo = dict(fo)
    if _prepped(fo):
        fo.setdefault("cuts", [0])
        fo["n"] = len(fo["frames"])
        return fo
    fps0, w0 = TYPE_DEFAULTS.get(kind, (DEFAULT_FPS, DEFAULT_WIDTH))
    fps = float(fo.get("fps") or fps0)
    width = int(fo.get("width") or w0) // 2 * 2
    aspect = float(fo.get("aspect") or 16 / 9)
    height = int(round(width / aspect / 2)) * 2
    cy, cx = float(fo.get("crop_y", 0.5)), float(fo.get("crop_x", 0.5))
    frames, cuts, clips = [], [], []
    for k, clip in enumerate(fo.get("clips") or []):
        clip = dict(clip) if isinstance(clip, dict) else {"src": str(clip)}
        src = _resolve(clip["src"], base)
        if not src.exists():
            raise FileNotFoundError(f"almanac_prep: footage clip not found: {src}")
        info = _probe(src)
        t_in = max(0.0, float(clip.get("in") or 0.0))
        t_out = float(clip.get("out") if clip.get("out") is not None else info["duration"] or t_in + 1)
        if info["duration"]:
            t_out = min(t_out, info["duration"])
        if t_out <= t_in:
            raise ValueError(f"almanac_prep: clip {k} ({src.name}) has out {t_out} <= in {t_in}")
        n_want = max(1, int(round((t_out - t_in) * fps)))
        deint = clip.get("deint", fo.get("deint", "auto"))
        if deint == "auto":
            deint = _interlaced(src, t_in, t_out - t_in, info)
        st = src.stat()
        key = json.dumps([str(src.resolve()), st.st_size, st.st_mtime_ns, t_in, t_out, fps, width, height, cy, cx,
                          bool(deint), 4], sort_keys=True)
        out = Path(cache) / "footage" / hashlib.sha1(key.encode()).hexdigest()[:16]
        done = sorted(out.glob("f_*.jpg")) if (out / "done").exists() else []
        if not done:
            shutil.rmtree(out, ignore_errors=True)
            out.mkdir(parents=True, exist_ok=True)
            vf = []
            if deint:                                              # BEFORE any scaling: fields smear once scaled
                vf.append("bwdif=mode=send_frame:parity=auto:deint=all")
            if abs(info["sar"] - 1.0) > 1e-3:
                vf.append("scale=trunc(iw*sar/2)*2:ih,setsar=1")
            vf += [f"fps={fps:g}",
                   f"scale={width}:{height}:force_original_aspect_ratio=increase:flags=lanczos"
                   ":out_color_matrix=bt601:out_range=full",
                   f"crop={width}:{height}:(iw-{width})*{cx:.4f}:(ih-{height})*{cy:.4f}",
                   "format=yuvj420p"]
            r = subprocess.run([FFMPEG, "-nostdin", "-v", "error", "-ss", f"{t_in:.3f}", "-i", str(src),
                                "-t", f"{t_out - t_in:.3f}", "-an", "-vf", ",".join(vf), "-frames:v", str(n_want),
                                "-q:v", "4", str(out / "f_%04d.jpg"), "-y"], capture_output=True, text=True,
                               encoding="utf-8", errors="replace", timeout=600)
            done = sorted(out.glob("f_*.jpg"))
            if r.returncode != 0 or not done:
                raise RuntimeError(f"almanac_prep: ffmpeg failed on {src.name}: {r.stderr.strip()[:300]}")
            (out / "done").write_text(str(len(done)))
        cuts.append(len(frames))
        frames += [str(p) for p in done]
        clip.update({"in": round(t_in, 3), "out": round(t_out, 3), "n": len(done), "deint": bool(deint)})
        clips.append(clip)
    fo.update({"clips": clips, "frames": frames, "cuts": cuts, "n": len(frames), "fps": fps,
               "width": width, "height": height})
    return fo


# ── cut-outs ─────────────────────────────────────────────────────────────────────────────────────
def _facebox_bin():
    """The optional Vision face-box tool (macOS only): prints {"faces": [[x, y, w, h], ...]} in image fractions."""
    for c in (os.environ.get("ALMANAC_FACEBOX"), HERE / "tools" / "facebox"):
        if c and Path(c).is_file() and os.access(str(c), os.X_OK):
            return str(c)
    return None


def _vision_face(path: Path):
    """[cx, cy, fh] from macOS Vision's largest face, or None (not a Mac, no tool, no face, any error)."""
    if platform.system() != "Darwin":
        return None
    fb = _facebox_bin()
    if not fb:
        return None
    try:
        r = subprocess.run([fb, str(path)], capture_output=True, text=True, encoding="utf-8", errors="replace",
                           timeout=30)
        j = json.loads(r.stdout.strip().splitlines()[0])
        if j.get("faces"):
            x, y, fw, fh = j["faces"][0]
            return [x + fw / 2, y + fh / 2, fh]
    except Exception:                                          # noqa: BLE001 - Vision is optional
        return None
    return None


def is_cutout(path: Path) -> bool:
    """A PNG (or WebP) with real transparency: ≥ 2 % clear pixels and ≥ 5 % solid ones."""
    if path.suffix.lower() not in (".png", ".webp") or not path.exists():
        return False
    try:
        with Image.open(path) as im:
            if im.mode not in ("RGBA", "LA", "PA") and not (im.mode == "P" and "transparency" in im.info):
                return False
            a = np.asarray(im.convert("RGBA").split()[3].resize((192, 192)))
    except Exception:                                          # noqa: BLE001
        return False
    return (a < 16).mean() > 0.02 and (a > 240).mean() > 0.05


def trim_cutout(path: Path, cache: Path, pad: int = 8, limit: int = 2048) -> Path:
    """A background-removed photo cropped to its figure: the scenes fit a cut-out by its image box, so the empty
    frame a remover leaves around a person would shrink them and float them off the page's edge. A side the figure
    was cut by (it reaches the frame) stays at the frame, so `edges` still sees it; a free side keeps `pad` px of
    air. The long side is capped at `limit`. Returns the original path when there is nothing to trim or it fails."""
    path = Path(path)
    try:
        st = path.stat()
        key = hashlib.sha1(f"{path.resolve()}|{st.st_size}|{st.st_mtime_ns}|{pad}|{limit}".encode()).hexdigest()[:16]
        out = Path(cache) / f"trim_{key}.png"
        if out.exists() and out.stat().st_size > 500:
            return out
        im = Image.open(path).convert("RGBA")
        a = np.asarray(im)[:, :, 3]
        ys, xs = np.where(a > 8)
        if not len(ys):
            return path
        w, h = im.size
        box = (max(0, int(xs.min()) - pad), max(0, int(ys.min()) - pad),
               min(w, int(xs.max()) + 1 + pad), min(h, int(ys.max()) + 1 + pad))
        if box == (0, 0, w, h) and max(w, h) <= limit:
            return path
        im = im.crop(box)
        if max(im.size) > limit:
            im.thumbnail((limit, limit), Image.LANCZOS)
        out.parent.mkdir(parents=True, exist_ok=True)
        part = out.with_suffix(".part.png")
        im.save(part, "PNG")
        part.replace(out)
        return out
    except Exception:                                          # noqa: BLE001 - the untrimmed cut-out still renders
        return path


def _alpha_face(solid, ys, xs, w: int, h: int) -> list:
    """The face from the silhouette alone (no Vision). A person cut-out's head is the alpha between 5 % and 15 % of
    the image height below its top; calibrated against Vision on ten person cut-outs: face centre = top + 1.02·head
    width, face height = 1.13·head width (4–10 % off; a hat brim reads wider, so a hatted face lands ~20 % high).
    Anything without such a head falls back to the top 42 % of the alpha."""
    if not len(ys):
        return [0.5, 0.36, 0.3]
    y0, y1 = int(ys.min()), int(ys.max())
    band = [y for y in range(y0 + int(0.05 * h), min(y1, y0 + int(0.15 * h))) if solid[y].any()]
    if len(band) >= 3:
        spans = [np.where(solid[y])[0] for y in band]
        hw = float(np.median([sp.max() - sp.min() + 1 for sp in spans]))
        hc = float(np.median([(sp.max() + sp.min()) / 2 for sp in spans]))
        if hw >= 0.08 * w:
            return [hc / w, min(0.9, (y0 + 1.02 * hw) / h), 1.13 * hw / h]
    head = ys < y0 + 0.42 * (y1 - y0)
    hy = ys[head]
    return [float(xs[head].mean() / w), float((hy.min() + hy.max()) / 2 / h), float((hy.max() - hy.min()) / h * 0.8)]


def cut_meta(path: Path, cache: Path | None = None) -> dict:
    st = path.stat()
    key = f"{path.resolve()}|{st.st_size}|{st.st_mtime_ns}"
    db_file = (Path(cache) / "cutmeta.json") if cache else None
    db = {}
    if db_file and db_file.exists():
        try:
            db = json.loads(db_file.read_text(encoding="utf-8"))
        except ValueError:
            db = {}
    if key in db:
        return dict(db[key])
    im = Image.open(path).convert("RGBA")
    w, h = im.size
    a = np.asarray(im)[:, :, 3].astype(np.float32) / 255.0
    solid = a > 100 / 255
    ys, xs = np.where(solid)
    ea = {"l": float(a[:, :3].mean()), "t": float(a[:3, :].mean()), "r": float(a[:, -3:].mean()), "b": float(a[-3:, :].mean())}
    edges = "".join(s for s in "ltrb" if ea[s] > 0.12)
    face, src = _vision_face(path), "vision"
    if face is None:
        src = "alpha"
        face = _alpha_face(solid, ys, xs, w, h)
    meta = {"ar": round(w / h, 4), "nat": [w, h], "face": [round(float(v), 4) for v in face], "face_src": src,
            "edges": edges, "edge_alpha": {k: round(v, 3) for k, v in ea.items()},
            "top": round(float(ys.min() / h), 4) if len(ys) else 0.0}
    if db_file:
        db[key] = meta
        db_file.parent.mkdir(parents=True, exist_ok=True)
        db_file.write_text(json.dumps(db, indent=1), encoding="utf-8")
    return dict(meta)


# ── the walk ─────────────────────────────────────────────────────────────────────────────────────
def prep_scene(sc: dict, base: Path, cache: Path = None, inline: bool = False, kind: str | None = None) -> dict:
    """Footage → frames, cut-outs → metadata, then (optionally) every image path → data URI. Returns a new dict."""
    base, cache = Path(base), Path(cache) if cache else default_cache()
    kind = kind or str(sc.get("type") or "")

    def walk(v, key=None, depth=0):
        if key in RESERVED and depth == 1:
            return v
        if key == "footage" and (isinstance(v, list) or (isinstance(v, dict) and (v.get("clips") or v.get("frames")))):
            return prep_footage(v, base, cache, kind)
        if isinstance(v, dict):
            out = {k: walk(x, k, depth + 1) for k, x in v.items()}
            s = out.get("src")
            if (isinstance(s, str) and not s.startswith("data:") and not all(k in out for k in ("ar", "face", "edges"))
                    and is_cutout(_resolve(s, base))):
                for k2, x2 in cut_meta(_resolve(s, base), cache).items():
                    out.setdefault(k2, x2)
            return out
        if isinstance(v, list):
            return [walk(x, key, depth + 1) for x in v]
        if isinstance(v, str) and key != "src" and not v.startswith("data:") and v.lower().endswith((".png", ".webp")):
            p = _resolve(v, base)
            if is_cutout(p):
                return dict({"src": v}, **cut_meta(p, cache))
        return v

    out = walk(dict(sc), None, 0)
    return inline_images(out, base) if inline else out


def data_uri(p: Path) -> str:
    kind = {"png": "image/png", "webp": "image/webp", "gif": "image/gif"}.get(p.suffix.lower().lstrip("."), "image/jpeg")
    return f"data:{kind};base64," + base64.b64encode(p.read_bytes()).decode()


def inline_images(v, base: Path):
    """Every string that names an existing local image, at any depth and inside lists, becomes a data URI."""
    if isinstance(v, dict):
        return {k: inline_images(x, base) for k, x in v.items()}
    if isinstance(v, list):
        return [inline_images(x, base) for x in v]
    if isinstance(v, str) and not v.startswith("data:") and v.lower().endswith(IMG_EXT):
        p = _resolve(v, Path(base))
        if p.is_file():
            return data_uri(p)
    return v


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("scene")
    ap.add_argument("out")
    ap.add_argument("--base", default=".")
    ap.add_argument("--cache", default=None)
    ap.add_argument("--inline", action="store_true")
    a = ap.parse_args()
    base = Path(a.base).resolve()
    cache = Path(a.cache).resolve() if a.cache else default_cache()
    sc = json.loads(Path(a.scene).read_text(encoding="utf-8"))
    out = prep_scene(sc, base, cache, inline=a.inline)
    Path(a.out).write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    fo = out.get("footage") if isinstance(out.get("footage"), dict) else None
    print("ok", a.out, f"frames {fo['n']} cuts {fo['cuts']}" if fo else "")


if __name__ == "__main__":
    sys.exit(main())
