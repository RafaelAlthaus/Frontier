#!/usr/bin/env python3
"""animate.py — set some of a video's stills in motion with a cheap image-to-video model (WaveSpeed Seedance).

A style asks for it with `look.animate`:

    "animate": {"every": 2, "seconds": 5, "resolution": "720p", "max": 8,
                "model": "bytedance/seedance-v1-pro-fast/image-to-video",
                "prompt": "slow smooth camera push, gentle parallax, the characters blink and breathe, flags and
                           cloth move a little, clouds drift; nothing new appears; keep the flat cartoon look"}

ensure(engine, plan, job, style) is called by the engine before the segments are rendered: every `every`-th
still slot of the plan (up to `max`) gets `<still>.anim.mp4` beside it — the model's clip, starting on that
exact picture — and the engine plays it as footage (never looped: a slot longer than the clip holds its last
frame). Clips are cached: a second render animates nothing.

Cost (WaveSpeed, September 2026): Seedance V1 Pro Fast $0.024 per second at 720p — a 5-second move ≈ $0.12,
eight of them ≈ $1. Skipped, with a line in the log, when the balance is under the reserve.
"""

import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

DEFAULTS = {"every": 2, "seconds": 5, "resolution": "720p", "max": 8, "parallel": 3,
            "model": "bytedance/seedance-v1-pro-fast/image-to-video",
            "prompt": "slow smooth cinematic camera push, gentle parallax, subtle natural motion, nothing new appears, "
                      "the picture keeps exactly its style and composition"}


def settings(engine, style: str) -> dict:
    look = ((getattr(engine, "STYLE_INFO", {}) or {}).get(style) or {}).get("look") or {}
    cfg = dict(DEFAULTS)
    if isinstance(look.get("animate"), dict):
        cfg.update({k: v for k, v in look["animate"].items() if k in DEFAULTS})
    return cfg


def ensure(engine, plan: list, job: Path, style: str) -> int:
    import wavespeed
    cfg = settings(engine, style)
    stills = [(i, Path(str(e[1]))) for i, e in enumerate(plan) if e[0] == "photo" and Path(str(e[1])).exists()]
    picks = [(i, p) for k, (i, p) in enumerate(stills) if k % max(1, int(cfg["every"])) == 0][: int(cfg["max"])]
    todo = [(i, p) for i, p in picks if not (p.with_suffix(".anim.mp4").exists() and p.with_suffix(".anim.mp4").stat().st_size > 20_000)]
    if not todo:
        if picks:
            engine.log(f"animate: {len(picks)} still(s) already in motion")
        return len(picks)
    if not wavespeed.has_budget():
        engine.log("animate: WaveSpeed balance under its reserve — the stills stay still")
        return 0
    engine.log(f"animate: {len(todo)} still(s) set in motion ({cfg['model'].split('/')[1]}, {cfg['seconds']} s at {cfg['resolution']})...")
    cache = job / "animate_uploads.json"

    def one(item):
        i, p = item
        dest = p.with_suffix(".anim.mp4")
        try:
            url = wavespeed.upload(p, cache)
            payload = {"image": url, "prompt": str(cfg["prompt"]), "duration": int(cfg["seconds"]),
                       "resolution": str(cfg["resolution"]), "camera_fixed": False, "seed": -1}
            wavespeed.run(cfg["model"], payload, dest, label=f"animate {p.stem}", timeout_s=1200, log=engine.log)
            return dest.exists() and dest.stat().st_size > 20_000
        except Exception as e:                                # noqa: BLE001 - this still plays as a still
            engine.log(f"  animate: {p.name} stays still — {str(e)[:100]}")
            dest.unlink(missing_ok=True)
            return False

    with ThreadPoolExecutor(max_workers=max(1, int(cfg["parallel"]))) as ex:
        done = sum(1 for ok in ex.map(one, todo) if ok)
    engine.log(f"animate: {done} of {len(todo)} clip(s) made")
    (job / "animate.json").write_text(json.dumps({"picked": [str(p) for _, p in picks]}, indent=1), encoding="utf-8")
    return done
