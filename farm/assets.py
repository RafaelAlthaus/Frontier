"""farm/assets.py — the half of a video that is made on your own computer.

A render is two very different kinds of work. Most of the clock is spent waiting
on somebody's API — Claude writing the script and directing the edit, ElevenLabs
speaking it, an image model drawing the stills. Very little of it is your
processor doing anything. Then comes the part that *is* processor work: drawing
the motion graphics in Chromium and encoding the video.

Renting a machine to sit and wait on an API is paying by the hour to do nothing,
and it is worst exactly when things go wrong — measured on real jobs, a stalled
image step once waited 77 minutes and a stalled director 50. So the waiting is
done here, where waiting is free, and only the processor work is rented.

What travels is small: a voiceover and ten stills come to about 13 MB, so the
upload is seconds. The one thing deliberately left on the pod is the YouTube
footage — 26 to 778 MB of raw clips, which would otherwise come DOWN your line
from YouTube and then go straight back UP to the pod, the same bytes twice.

None of this needs the engine changed. The pipeline already skips any step whose
output is on disk (36 of them check), so the pod runs the whole thing and finds
most of it already done.
"""

from __future__ import annotations

import re
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent

# The steps whose cost is waiting, not computing. `images` is conditional: a
# Documentary is built from real footage and has AI pictures switched off, so
# asking for the step by name drew ten stills nobody wanted and spent the
# credits to do it. The channel's own switches decide.
LOCAL_STEPS = ("script", "voiceover")

# Working material the pod makes for itself. Packing it would send the very
# gigabytes this split exists to avoid — and `segments`/`motion` are the
# processor work being rented in the first place.
SKIP = ("segments", "clip_src", "clips", "youtube", "pexels", "motion",
        "maps", "headlines", "photofx", "vox_scenes", "__pycache__",
        # the TTS chunks the voice was joined from. audio.mp3 is what the
        # pipeline checks for, so sending these too doubles the upload and
        # buys nothing.
        "_chunks_audio")

# Files the pod makes for itself. `video.mp4` is the thing being rented — packing
# it would upload a finished video in order to ask for one — and `_voice_sound.wav`
# is the graded voice bed, rebuilt from audio.mp3 during the render. Any .mp4 at
# the top of the job folder is the finished video under its own title.
SKIP_FILES = ("video.mp4", "_voice_sound.wav", "subs_burn.ass")

# Thumbnails are drawn here and are wanted here. The pod has no use for them,
# and at a megabyte each they are most of an upload that should be small.
SKIP_PREFIX = ("thumbnail", "_thumbart")


def _base(name: str) -> str:
    """The name with Finder's duplicate suffix removed: "plan 2.json" -> "plan.json".

    Copying a job folder in Finder leaves these behind, and one of them is a
    24 MB voice bed — matched on the exact name alone, it rides along.
    """
    stem, dot, ext = name.rpartition(".")
    if not dot:
        stem, ext = name, ""
    stem = re.sub(r" \d+$", "", stem)
    return f"{stem}.{ext}" if ext else stem


def prepare(spec: dict, sink=None) -> Path:
    """Run the waiting-shaped steps here, and return the job folder.

    Thumbnails come too: it is an image model call, so it is waiting, and what
    comes back is a PNG measured in kilobytes.
    """
    say = sink or (lambda line: print(line, flush=True))
    import make_video as mv
    import motion
    import styles
    styles.apply_to_engine(mv, motion)

    steps = set(LOCAL_STEPS)
    if _wants_ai_images(mv, spec):
        steps.add("images")
    if "thumbnail" in (spec.get("steps") or []):
        steps.add("thumbnail")

    say(f"preparing {spec['title'][:60]!r} on this computer "
        f"({', '.join(sorted(steps))})")
    kwargs = {k: v for k, v in spec.items() if k not in ("slug", "queued_at")}
    kwargs["steps"] = sorted(steps)
    kwargs["sink"] = say
    mv.run_custom(**kwargs)

    job = mv.job_dir(spec.get("title") or spec["slug"], spec.get("style") or "")
    _direct_here(mv, job, spec, say)

    # The thumbnails were drawn here and stay here — they are not packed, because
    # a pod has no use for a picture of the video it is making. But leaving the
    # step in the spec makes the pod draw its own set and pay for them a second
    # time, so the step comes out once there is something to show for it.
    if any(job.glob("thumbnail*.png")) and "thumbnail" in (spec.get("steps") or []):
        spec["steps"] = [x for x in spec["steps"] if x != "thumbnail"]
        say("  thumbnails: done here — the pod will not draw its own")
    return job


def _wants_ai_images(mv, spec: dict) -> bool:
    """Does this channel actually draw pictures, once its switches are read?

    The same answer the engine gives itself, from features.resolve — asked here
    so the preparation does not buy something the render would not have used.
    """
    try:
        import features
        return bool(features.resolve(mv.STYLE_INFO.get(spec.get("style") or "") or {},
                                     spec.get("features")).get("ai_images"))
    except Exception:                               # noqa: BLE001 - if unsure, don't spend
        return False


def _direct_here(mv, job: Path, spec: dict, say) -> None:
    """Have the director decide the edit here too, if this channel uses one.

    It reads the narration and the subtitles and asks Claude what the viewer
    sees, sentence by sentence — and it needs no footage to do it, which is why
    the engine already runs it beside the voiceover. On a real job this call
    once sat waiting 50 minutes; here that costs nothing.

    Best effort on purpose: `director.json` is cached like everything else, so a
    failure just means the pod does it, which is what happens today.
    """
    style = spec.get("style") or ""
    srt = job / "subs.srt"
    try:
        if not mv._directed(style):
            return
        if not srt.exists():
            say("  director: no subtitles yet — the pod will direct it")
            return
        import director
        say("  director: planning the edit here (Claude)")
        mv._word_clock(job, srt)
        script = (job / "script.txt").read_text(encoding="utf-8")
        director.draft(mv, script, job, style, spec.get("title", ""))
        director.plan(mv, srt, job, style, spec.get("title", ""))
        say("  director: done — the pod will not pay for this")
    except Exception as e:                      # noqa: BLE001 - the pod can still do it
        say(f"  director: leaving it to the pod — {str(e)[:120]}")


def _wanted(job: Path, p: Path):
    """The path this file takes inside the zip, or None if it stays here."""
    rel = p.relative_to(job)
    if rel.parts[0] in SKIP or p.name.startswith(".") or _base(p.name) in SKIP_FILES:
        return None
    if len(rel.parts) == 1 and p.name.startswith(SKIP_PREFIX):
        return None
    if len(rel.parts) == 1 and p.suffix.lower() == ".mp4":
        return None                            # the finished video, under its title
    return rel.as_posix()


def pack(job: Path, dest: Path) -> int:
    """Zip what the pod cannot make for itself, and nothing else."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    n = 0
    with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED, compresslevel=1) as z:
        for p in sorted(job.rglob("*")):
            if not p.is_file():
                continue
            name = _wanted(job, p)
            if name is None:
                continue
            try:
                z.write(p, name)
            except OSError as e:
                # A file on an iCloud-backed folder can be evicted to the cloud and
                # time out on read. Better to say which one than to ship a job
                # missing its voiceover and find out an hour into a pod.
                raise OSError(
                    f"could not read {p.relative_to(job)} from {job.name}: {e}. "
                    "If this folder is in iCloud Drive, download it "
                    "(Finder -> right-click -> Download Now) and queue it again.") from e
            n += 1
    return n


def unpack(blob: Path, job: Path) -> int:
    """On the pod: put them where the pipeline will find them and skip the work.

    Anything already there wins — a pod that is retrying has its own work on
    disk, and the assets it was handed have not changed.
    """
    job.mkdir(parents=True, exist_ok=True)
    n = 0
    with zipfile.ZipFile(blob) as z:
        for info in z.infolist():
            if info.is_dir():
                continue
            name = info.filename.replace("\\", "/")
            if name.startswith("/") or ".." in name.split("/"):
                continue                       # never write outside the job folder
            out = job / name
            if out.exists():
                continue
            out.parent.mkdir(parents=True, exist_ok=True)
            with z.open(info) as src, out.open("wb") as dst:
                dst.write(src.read())
            n += 1
    return n
