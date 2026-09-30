#!/usr/bin/env python3
"""tidy_output.py — sort an output folder into the layout Frontier uses since Frontier 5:

    output/<channel>/<Video title>/       the video (once), its description, its thumbnails — what goes to YouTube
    output/<channel>/_work/<slug>/        everything else: voice, footage, segments, plans

Videos made before lived in output/<slug>/ with the video twice (video.mp4 and a copy named after the title). This
moves each of them into its channel's folder, keeps ONE video under its title, and puts the rest in _work/. The paths
written inside the job's own files move with it, so a later re-render still finds everything. Nothing is re-rendered
and nothing is deleted except the second copy of the video.

    python tidy_output.py                              # show what would move — nothing changes
    python tidy_output.py --apply                      # do it
    python tidy_output.py --apply "D:/Frontier output" # another output folder (FRONTIER_OUTPUT)

A folder touched in the last 15 minutes is left alone (a render may be working in it); --force moves it anyway.
"""
import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import make_video as mv  # noqa: E402
import motion  # noqa: E402
import styles  # noqa: E402

styles.load_all()                       # a variant look files under its channel's folder
styles.apply_to_engine(mv, motion)

TEXT = (".json", ".txt", ".srt", ".ass", ".csv")


def _first_line(f: Path, default: str) -> str:
    try:
        return f.read_text(encoding="utf-8").splitlines()[0].strip() or default
    except (OSError, IndexError):
        return default


def _busy(d: Path, minutes: float = 15.0) -> bool:
    cutoff = time.time() - minutes * 60
    try:
        for p in d.rglob("*"):
            if p.stat().st_mtime > cutoff:
                return True
    except OSError:
        return True
    return False


def _copies(d: Path) -> list:
    """The title-named copies of video.mp4 an older Frontier left next to it (same size, any name)."""
    v = d / "video.mp4"
    if not v.exists():
        return []
    size = v.stat().st_size
    return [p for p in d.glob("*.mp4") if p.name != "video.mp4" and not p.name.startswith(("_", "."))
            and p.name != "video_plain.mp4" and p.stat().st_size == size]


def _repath(work: Path, old: Path) -> int:
    """The job's own files name their pictures, clips and segments by absolute path: those paths move too."""
    pairs = [(str(old), str(work)), (json.dumps(str(old))[1:-1], json.dumps(str(work))[1:-1]),
             (old.as_posix(), work.as_posix())]
    pairs = [(a, b) for a, b in dict(pairs).items() if a and a != b]
    n = 0
    for f in work.rglob("*"):
        if f.suffix.lower() not in TEXT or not f.is_file() or f.name.startswith("._"):
            continue
        try:
            if f.stat().st_size > 50_000_000:
                continue
            t = f.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        u = t
        for a, b in pairs:
            u = u.replace(a, b)
        if u != t:
            try:
                f.write_text(u, encoding="utf-8")
                n += 1
            except OSError:
                pass
    return n


def plan(root: Path, force: bool = False) -> list:
    """[(old folder, new working folder, title, why-not or "")]"""
    rows = []
    for d in sorted(root.iterdir()):
        if d.name.startswith((".", "_")) or not mv._is_old_job(d):
            continue                                        # a channel folder, _tools, or not a video
        style = _first_line(d / "style.txt", "videos")
        title = _first_line(d / "title.txt", d.name)
        work = root / mv.style_folder(style) / mv.WORK_DIR / d.name
        why = ""
        if work.exists():
            why = "already there"
        elif not force and _busy(d):
            why = "in use (changed in the last 15 minutes)"
        rows.append((d, work, title, why))
    return rows


def tidy(root: Path, apply: bool, force: bool = False) -> None:
    mv.OUTPUT_ROOT = root
    rows = plan(root, force)
    if not rows:
        print(f"{root}: nothing to sort — every video is already in its channel's folder")
        return
    freed, moved, failed, claimed = 0, 0, 0, []
    for d, work, title, why in rows:
        if why:
            print(f"  skip  {d.name}  ({why})")
            continue
        dups = _copies(d)
        home = work.parent.parent / os.path.splitext(mv.youtube_filename(title))[0]
        if (home / ".frontier-video").exists() or any(h == home for h in claimed):
            home = home.with_name(f"{home.name} ({d.name})")
        claimed.append(home)
        print(f"  {'move' if apply else 'would move'}  {d.name}  ->  {home.relative_to(root)}/"
              + (f"  (second copy removed: {', '.join(x.name for x in dups)})" if dups else ""))
        if not apply:
            continue
        try:
            work.parent.mkdir(parents=True, exist_ok=True)
            os.rename(d, work)                              # one rename: same drive, nothing copied
        except OSError as e:
            print(f"    ! not moved ({e.__class__.__name__}: {e}) — it stays where it was")
            failed += 1
            continue
        for x in _copies(work):                             # video.mp4 is the same film; it moves up below
            try:
                freed += x.stat().st_size if x.stat().st_nlink == 1 else 0
                x.unlink()
            except OSError:
                pass
        _repath(work, d)
        try:
            mv.publish_named_copy(work, title)
            moved += 1
        except Exception as e:                              # noqa: BLE001 - one video never stops the rest
            print(f"    ! moved, but the video could not be published ({e}) — it is in {work}")
            failed += 1
    if apply:
        print(f"\n{moved} video(s) sorted" + (f", {failed} left as they were" if failed else "")
              + (f", {freed / 1e9:.1f} GB of second copies freed" if freed else ""))
    else:
        print("\nNothing changed. Run again with --apply to move them.")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    root = Path(args[0]).expanduser() if args else mv.OUTPUT_ROOT
    if not root.is_dir():
        sys.exit(f"no output folder at {root}")
    tidy(root, apply="--apply" in sys.argv, force="--force" in sys.argv)
