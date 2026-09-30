"""farm/spec.py — one video, written down.

A job spec is the same dictionary the Create button already builds in app.py,
plus a title and a slug. It is a few kilobytes of JSON, which is the whole point
of the split: your Mac decides what the video is and writes the narration, and
only that travels. The gigabytes — the voice, the pictures, the footage — are
made on the pod, where the connection is a datacentre's rather than your flat's.
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

ALL_STEPS = ("script", "voiceover", "pexels", "images", "video", "thumbnail")

DEFAULTS = {
    "minutes": 20, "steps": ["video", "thumbnail"], "script_text": "",
    "burn_subs": True, "force": False, "thumb_count": 2, "use_motion": True,
    "byo_audio": "", "character": "", "character_image": "", "mix": (),
    "meta": None, "maps": True, "headlines": True, "spotlight": True,
    "objects": True, "depth": True, "features": None, "extra": "",
    # the AI presenter: which face and how many seconds. build() only keeps keys
    # listed here, so without these two a presenter picked in the app was
    # dropped on its way to the pod and the video came back without one.
    "avatar_id": "", "avatar_s": 0, "avatar_count": 1,
}

# run_custom() takes every spec key except these, which name the job or belong to the runner: `post` (finishing
# passes run after the render, see runner.run_post) and `env` (render settings the pod exports before it starts).
_NOT_KWARGS = ("slug", "queued_at", "post", "env")


def slugify(title: str) -> str:
    """The job's folder name — byte for byte what make_video.slugify gives.

    The Mac names the bucket key and the pod names the output folder, so if the
    two ever disagreed the Mac would come back for a video that is filed under a
    different name. The engine's own function is used whenever it imports; the
    copy below is the same algorithm for the case where it does not, digest and
    all: without that digest two titles sharing a long opening collapse into one
    folder and the second render hands back the first one's video.
    """
    try:
        from make_video import slugify as _engine_slugify
        return _engine_slugify(title)
    except Exception:                                  # noqa: BLE001 - engine not importable
        pass
    s = re.sub(r"[^a-z0-9]+", "-", (title or "").lower()).strip("-") or "video"
    if len(s) <= 52:
        return s
    digest = hashlib.sha1((title or "").strip().encode("utf-8")).hexdigest()[:6]
    return f"{s[:52].rstrip('-')}-{digest}"


def build(title: str, style: str, **opts) -> dict:
    spec = dict(DEFAULTS)
    spec.update({k: v for k, v in opts.items() if k in DEFAULTS})
    spec["title"] = (title or "").strip()
    spec["style"] = style
    spec["slug"] = opts.get("slug") or slugify(spec["title"])
    spec["minutes"] = max(1, min(60, int(spec["minutes"] or 20)))
    spec["thumb_count"] = max(1, min(4, int(spec["thumb_count"] or 2)))
    spec["steps"] = [s for s in (spec["steps"] or []) if s in ALL_STEPS] or ["video"]
    spec["avatar_id"] = str(spec.get("avatar_id") or "").strip()[:64]
    spec["avatar_s"] = max(0.0, min(float(spec.get("avatar_s") or 0), 15.0))
    spec["avatar_count"] = max(1, min(int(spec.get("avatar_count") or 1), 6))
    return spec


def problems(spec: dict) -> list:
    """Everything wrong with this spec, in words you can act on."""
    out = []
    if not (spec.get("title") or "").strip():
        out.append("no title")
    if not (spec.get("style") or "").strip():
        out.append("no channel — which style file should render it?")
    if not spec.get("steps"):
        out.append("no steps — nothing to make")
    if spec.get("byo_audio"):
        out.append("byo_audio names a file on your Mac; the pod cannot see it. "
                   "Render a bring-your-own voiceover locally.")
    if (spec.get("character_image") or "").startswith("/"):
        out.append("character_image must be a path inside assets/, not an absolute one")
    return out


def run_kwargs(spec: dict) -> dict:
    """The spec as make_video.run_custom() wants it."""
    kw = {k: v for k, v in spec.items() if k not in _NOT_KWARGS}
    kw["title"] = kw.pop("title", "")
    if isinstance(kw.get("mix"), list):
        kw["mix"] = tuple(kw["mix"])
    return kw


def save(spec: dict, path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(spec, indent=2, ensure_ascii=False), encoding="utf-8")
    return path


def load(path: Path) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))
