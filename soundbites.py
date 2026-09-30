#!/usr/bin/env python3
"""soundbites.py — real interview clips with their own sound, and the name montage that opens a film.

A sports documentary lets the man speak. The script marks where ("[[clip: Martin on being laughed at for
driving a UPS truck]]" on its own line, cinema.split_chapters keeps them in clips_wanted.json), and this module:

    1. finds the interview on YouTube — the subject's own interviews, or people talking about them —
       and reads each video's word-timed captions (YouTube's json3 track, free);
    2. lets Claude choose the exact lines that say what the script wants, and cuts them out with their
       sound (yt-dlp downloads only those seconds);
    3. opens the narration there — silence cut into the voice, the subtitles moved with it (cinema.apply_pauses)
       — so the clip plays in the gap, and the narrator carries on after it.

The NAME MONTAGE (look.soundbites.montage): before the first word, three or four quick cuts of different people
saying the subject's name — a commentator, a coach, a host — the way the best channels open on a name.

A channel turns it on with `look.soundbites` in its style file:

    "soundbites": {"montage": true, "quotes": 2, "max_s": 9.0, "montage_max": 4}

Everything here is an extra: whatever goes wrong is logged, and the video is made without it.
"""

import json
import re
import shutil
import subprocess
import tempfile
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
W, H, FPS = 1920, 1080, 30
SEARCH_N = 8                 # videos per search
VIDEOS_MAX = 14              # videos whose captions are read
QUOTE_PAD = (0.25, 0.4)      # seconds kept before the first word and after the last
NAME_PAD = (0.42, 0.55)      # ...for a name in the montage
MONTAGE_CLIP = (1.4, 4.4)    # a montage cut, shortest and longest (a whole sentence about the man may play)
# no colour tags: the rest of the timeline is untagged, and a BT.709-tagged clip next to untagged segments froze the
# finishing pass at that cut (the picture stuck on the montage's last frame for the whole video)
ENC = ["-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-r", str(FPS)]

SUBJECT_PROMPT = """This is the opening of a documentary script titled "[INSERT TITLE HERE]":

[INSERT OPENING HERE]

Who is the main person the documentary is about? Return ONLY a JSON array with one object:
[{"subject": "the person's full name as commonly written", "aliases": ["surname", "nickname", "other spellings"],
  "sport": "the sport or field, in one or two words"}]"""

MONTAGE_PROMPT = """A sports documentary about [INSERT SUBJECT HERE] opens on a quick montage: different people on camera
saying his name — a commentator, a coach, a host, a teammate, the man himself — the way the best channels open on a
name. Below are moments from YouTube videos where the name is said, each with the words around it.

Choose up to [INSERT K HERE], best first, from DIFFERENT videos:
- best: a whole short sentence that introduces or praises him ("Spencer Haywood changed the game", "the great Spencer
  Haywood") — keep the sentence, it may run up to 4 seconds;
- good: the name said on its own with a breath either side;
- never: a sentence that says something negative, an advert, a list of many names, a sentence cut off mid-thought,
  or a moment about someone else who shares the name (a DJ, a streamer, another athlete) — only THIS person.
Return ONLY a JSON array: [{"n": 3, "why": "one short line"}, ...]  (n = the moment's number).

[INSERT MOMENTS HERE]"""

TALKING_PROMPT = """These are [INSERT N HERE] frames from video clips, numbered in the order the files were listed. A documentary
opens on people saying a name on camera. Which frames are FILMED PEOPLE in a setting where someone is speaking — an
interview, a podcast or radio desk (two hosts at microphones count), a studio, a press conference, a ceremony or a
stage, a news report with the person in shot, a speech at a podium? A wide shot of a desk or a stage is a yes.
Say no only for game action on the court, a still photograph, an animation, a drawing or a graphic, a title card or
logo screen, a screen recording, or an empty scene with nobody in it.
Answer ONLY with JSON: {"talking": [the numbers of the frames where someone is clearly speaking to camera or to a host],
"people": [the numbers of EVERY frame that shows filmed people in a talk setting — hosts at a desk, a guest in a chair,
a studio, a podium — whether or not a mouth is open]}"""

PICK_PROMPT = """You are the editor of a documentary about [INSERT SUBJECT HERE]. The narration says:

"[INSERT CONTEXT HERE]"

...and then the edit cuts to a real interview clip that should show: [INSERT WHAT HERE]

Below are the captions of YouTube videos, as numbered lines with minutes:seconds. Choose the ONE best stretch of one
video — at most [INSERT MAX HERE] seconds, a complete thought, someone speaking on camera (the subject themself is best;
a coach, a teammate, a commentator about them is fine) — that says it, or comes closest. Never a narrator reading a
script over footage, never music, never an advert, never someone else who shares the name.

[INSERT VIDEOS HERE]

Return ONLY a JSON array of up to three such stretches, best first (or [] when nothing fits):
[{"video": "the video id", "first_words": "the first 3 to 5 words of the stretch, copied exactly from the captions",
  "last_words": "the last 3 to 5 words, copied exactly", "why": "one short line"}]"""


def _log(mv, msg: str) -> None:
    (mv.log if mv is not None and hasattr(mv, "log") else print)(msg)


def settings(mv, style: str) -> dict:
    look = ((getattr(mv, "STYLE_INFO", {}) or {}).get(style) or {}).get("look") or {}
    cfg = look.get("soundbites") if isinstance(look.get("soundbites"), dict) else {}
    return {"on": bool(cfg), "montage": bool(cfg.get("montage", True)), "quotes": int(cfg.get("quotes", 2) or 0),
            "max_s": float(cfg.get("max_s") or 9.0), "montage_max": int(cfg.get("montage_max", 4) or 0),
            # "soundups": footage moments in the hook that play with their OWN sound — a dunk, a roar, a buzzer — the
            # narration pausing for each, the way a great recap intro breathes: a line, a clip, a line
            "soundups": int(cfg.get("soundups", 0) or 0),
            # "broadcast": the clips are moments of a broadcast in another language — a state TV anchor, a speech, an
            # announcement — found by a video model watching the video (its sound included) instead of by English
            # captions, and quoted under the picture in the channel's own language
            "broadcast": bool(cfg.get("broadcast", False))}


def _norm(w: str) -> str:
    s = unicodedata.normalize("NFKD", str(w).lower())
    return re.sub(r"[^a-z0-9]", "", "".join(c for c in s if not unicodedata.combining(c)))


def _stamp(t: float) -> str:
    t = max(0, int(t))
    return f"{t // 60}:{t % 60:02d}"


# ── captions with a time on every word ───────────────────────────────────────────
def words_of(vid: str, work: Path) -> list:
    """[(start, end, word)] — every word a video's English captions carry, on the video's clock. YouTube's json3
    track times each word; a manual track times each line, and its words are shared out by length. [] when the
    video has no English captions. Cached in work/words/<id>.json."""
    import requests
    import youtube
    out_f = work / "words" / f"{youtube._safe(vid)}.json"
    if out_f.exists():
        try:
            return [tuple(x) for x in json.loads(out_f.read_text(encoding="utf-8"))]
        except ValueError:
            pass
    rows = []
    try:
        youtube._source(vid, work)
        d = json.loads((work / "info" / f"{youtube._safe(vid)}.info.json").read_text(encoding="utf-8"))
        subs, auto = d.get("subtitles") or {}, d.get("automatic_captions") or {}
        fmt = None
        for table, key in ((auto, "en-orig"), (auto, "en"), (subs, "en"), (subs, "en-US"), (subs, "en-GB")):
            fmt = next((f for f in table.get(key) or [] if f.get("ext") == "json3"), None)
            if fmt:
                break
        if fmt:
            r = requests.get(fmt["url"], timeout=30, headers={"User-Agent": "Mozilla/5.0"})
            if r.ok:
                for e in r.json().get("events") or []:
                    t0 = float(e.get("tStartMs") or 0) / 1000.0
                    dur = float(e.get("dDurationMs") or 0) / 1000.0
                    segs = [x for x in (e.get("segs") or []) if str(x.get("utf8", "")).strip()]
                    if not segs:
                        continue
                    timed = [x for x in segs if x.get("tOffsetMs") is not None]
                    if len(timed) >= max(1, len(segs) - 1):
                        starts = [t0 + float(x.get("tOffsetMs") or 0) / 1000.0 for x in segs]
                        for i, x in enumerate(segs):
                            a = starts[i]
                            b = starts[i + 1] if i + 1 < len(segs) else min(t0 + dur, a + 0.9) if dur else a + 0.5
                            rows.append((round(a, 3), round(max(a + 0.05, b), 3), str(x["utf8"]).strip()))
                    else:
                        # one time for the whole line: its words by their letters
                        ws = " ".join(str(x["utf8"]) for x in segs).split()
                        weights = [len(w) + 1 for w in ws]
                        tot, acc = float(sum(weights) or 1), 0.0
                        for w, wt in zip(ws, weights):
                            a = t0 + dur * acc / tot
                            acc += wt
                            rows.append((round(a, 3), round(t0 + dur * acc / tot, 3), w))
    except Exception:                                      # noqa: BLE001 - no captions: nothing to cut
        rows = []
    rows = [r for r in rows if r[2] and not r[2].startswith("[")]
    out_f.parent.mkdir(parents=True, exist_ok=True)
    out_f.write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
    return rows


def _lines(words: list, per: int = 12) -> list:
    """[(second, text)] — the words grouped into short lines, for Claude to read."""
    out, cur, t0 = [], [], 0.0
    for a, b, w in words:
        if not cur:
            t0 = a
        cur.append(w)
        if len(cur) >= per or re.search(r"[.!?]$", w):
            out.append((t0, " ".join(cur)))
            cur = []
    if cur:
        out.append((t0, " ".join(cur)))
    return out


# ── finding videos ─────────────────────────────────────────────────────────────
def search(q: str, n: int = SEARCH_N) -> list:
    """[{id, title, duration, channel}] — like youtube.search, but interviews, podcasts and talk shows are exactly
    what a soundbite wants, so nothing is skipped by its title."""
    import youtube
    rows = []
    key = youtube._env("ALGROW_API_KEY")
    if key:
        try:
            import requests
            r = requests.get(f"{youtube.ALGROW}/api/search", params={"q": q, "type": "video", "limit": n},
                             headers={"Authorization": f"Bearer {key}"}, timeout=45)
            if r.ok:
                for v in (r.json().get("results") or []):
                    if v.get("type", "video") == "video" and v.get("video_id"):
                        rows.append({"id": v["video_id"], "title": v.get("title") or "",
                                     "duration": float(v.get("duration_seconds") or 0), "channel": v.get("channel_name") or ""})
        except Exception:                                  # noqa: BLE001 - yt-dlp's search below
            rows = []
    if not rows and youtube.ytdlp():
        try:
            p = subprocess.run(youtube.ytdlp() + ["--flat-playlist", "--no-warnings", "-j", f"ytsearch{n}:{q}"],
                               capture_output=True, text=True, timeout=120)
            for line in p.stdout.splitlines():
                try:
                    v = json.loads(line)
                except ValueError:
                    continue
                if v.get("id"):
                    rows.append({"id": v["id"], "title": v.get("title") or "", "duration": float(v.get("duration") or 0),
                                 "channel": v.get("channel") or v.get("uploader") or ""})
        except subprocess.TimeoutExpired:
            return []
    return [v for v in rows if not re.search(r"#shorts|\bmemes?\b|\blyrics\b", v["title"], re.I)]


NAMESAKE_PROMPT = """The documentary is about: [INSERT WHO HERE].
Below are YouTube videos found by searching that name. Which of them are about THIS person? Anyone else who shares the
name — a musician, a DJ, a streamer, a different athlete, a channel named after someone else — is out. Judge by the
title and the channel; when it cannot be told, keep it.
Return ONLY a JSON array of the numbers to keep, e.g. [1, 4, 5]

[INSERT VIDEOS HERE]"""


def _about(mv, vids: list, who: str) -> list:
    """The candidate videos that are about this person — a name shared with a DJ or a streamer once filled the
    montage with strangers saying the right name about the wrong man."""
    if not vids or not who:
        return vids
    rows = "\n".join(f"{k + 1}. {v.get('title', '')[:90]}  ({v.get('channel', '')[:40]})" for k, v in enumerate(vids))
    try:
        ans = mv._json_items(NAMESAKE_PROMPT.replace("[INSERT WHO HERE]", who).replace("[INSERT VIDEOS HERE]", rows), max_tokens=200)
        keep = set()
        for x in ans:
            x = x.get("n") if isinstance(x, dict) else x
            if str(x).strip().isdigit() and 1 <= int(x) <= len(vids):
                keep.add(int(x) - 1)
    except (SystemExit, Exception):                        # noqa: BLE001 - unjudged, everything stays
        return vids
    if not keep:
        return vids
    out = [v for k, v in enumerate(vids) if k in keep]
    if len(out) < len(vids):
        _log(mv, f"soundbites: {len(vids) - len(out)} video(s) about someone else with the name left out")
    return out


def _who(job: Path, subject: str) -> str:
    """One line saying who the subject is, for the prompts: the name, the sport and the episode title."""
    sport = ""
    try:
        sport = str(json.loads((job / "soundbites" / "subject.json").read_text(encoding="utf-8")).get("sport") or "")
    except (OSError, ValueError):
        pass
    title = (job / "title.txt").read_text(encoding="utf-8").splitlines()[0] if (job / "title.txt").exists() else ""
    return f"{subject}" + (f" ({sport})" if sport else "") + (f" — the episode: \"{title}\"" if title else "")


def _candidates(mv, subject: str, extra: list, work: Path, who: str = "") -> list:
    """[{id, title, duration, channel, words}] — videos about the subject with English captions, most first:
    interviews and talk shows first, because the montage wants people saying the name to camera."""
    queries = [f"{subject} interview", f"{subject} podcast", f"{subject} talks", f"{subject} NBA", f"{subject} documentary"] + [q for q in extra if q]
    seen, vids = set(), []
    with ThreadPoolExecutor(max_workers=4) as ex:
        for rows in ex.map(lambda q: search(q, SEARCH_N), queries):
            for v in rows:
                if v["id"] not in seen and 40 <= float(v.get("duration") or 0) <= 3600:
                    seen.add(v["id"])
                    vids.append(v)
    talk = re.compile(r"interview|podcast|talks|show|sits down|speaks|conversation|one on one|q&a|episode", re.I)
    vids = _about(mv, sorted(vids, key=lambda v: 0 if talk.search(v["title"]) else 1)[:VIDEOS_MAX + 6], who)[:VIDEOS_MAX]
    with ThreadPoolExecutor(max_workers=5) as ex:
        got = list(ex.map(lambda v: words_of(v["id"], work), vids))
    out = [dict(v, words=w) for v, w in zip(vids, got) if len(w) >= 40]
    _log(mv, f"soundbites: {len(out)} of {len(vids)} videos about {subject!r} have captions to read")
    return out


# ── cutting ────────────────────────────────────────────────────────────────────
def cut(vid: str, a: float, b: float, dest: Path, work: Path, zoom: float = 1.0, snap: bool = False,
        debar: bool = False, band: str = "") -> float:
    """The seconds [a, b] of a video, with sound: dest.mp4 (1920x1080, muted — the timeline joins pictures only)
    and dest.wav (its sound). Returns the length, 0.0 when nothing came. `snap`: move both edges to the nearest
    pause in the sound within a second — times read off a watching model are only good to about a second, and a
    clip that starts mid-syllable sounds cut."""
    import youtube
    pad = 1.0
    sa, sb = max(0.0, a - pad), b + pad
    sec = work / "sections" / f"{youtube._safe(vid)}_{sa:.1f}_{sb:.1f}_av.mp4"
    sec.parent.mkdir(parents=True, exist_ok=True)
    if not sec.exists():
        for attempt in range(2):
            src = youtube._source(vid, work) if attempt == 0 else [youtube._watch_url(vid)]
            subprocess.run(youtube.ytdlp() + ["-q", "--no-warnings", "-f",
                                              "bv*[height<=1080][vcodec^=avc1]+ba[ext=m4a]/bv*[height<=1080]+ba/b[height<=1080]/b",
                                              "--merge-output-format", "mp4",
                                              "--download-sections", f"*{sa:.2f}-{sb:.2f}", "--force-keyframes-at-cuts",
                                              "-o", str(sec.with_suffix("")) + ".%(ext)s"] + src,
                           capture_output=True, text=True, timeout=240)   # a 4 s section: a stalled read is not waited on for ten minutes
            got = sorted(sec.parent.glob(sec.stem + ".*"))
            if got:
                if got[0] != sec:
                    got[0].rename(sec)
                break
    if not sec.exists():
        return 0.0
    p = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(sec)],
                       capture_output=True, text=True)
    try:
        have = float(p.stdout.strip() or 0)
    except ValueError:
        have = 0.0
    start, length = a - sa, min(b - a, max(0.0, have - (a - sa)))
    if snap:
        start, length = _snap_to_pauses(sec, start, length, have)
    if length < 0.6:
        return 0.0
    dest.parent.mkdir(parents=True, exist_ok=True)
    z = max(1.0, float(zoom))
    # an old 4:3 broadcast inside a 16:9 upload carries black bars: they are cut off before the picture fills the frame
    bars = _active_area(sec, start, length) if debar else ""
    # someone else's subtitles in a band at the bottom (or top) of the picture: that band is cut off
    bars += {"bottom": "crop=iw:ih*0.74:0:0,", "top": "crop=iw:ih*0.74:0:ih*0.26,"}.get(band, "")
    vf = (bars + f"scale={int(W * z) // 2 * 2}:{int(H * z) // 2 * 2}:force_original_aspect_ratio=increase:flags=lanczos,"
          f"crop={W}:{H},setsar=1,fps={FPS}")
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-ss", f"{start:.3f}", "-t", f"{length:.3f}", "-i", str(sec), "-an",
                    "-vf", vf] + ENC + [str(dest.with_suffix(".mp4"))], check=True, capture_output=True)
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-ss", f"{start:.3f}", "-t", f"{length:.3f}", "-i", str(sec), "-vn",
                    "-ac", "2", "-ar", "48000",
                    # one level for every clip (a talk-show cut sat 20 dB under a Zoom interview), then the edge fades
                    "-af", "loudnorm=I=-16:TP=-1.5:LRA=11,afade=t=in:d=0.04,afade=t=out:st=" + f"{max(0.0, length - 0.06):.3f}:d=0.06",
                    "-c:a", "pcm_s16le", str(dest.with_suffix(".wav"))], check=True, capture_output=True)
    p = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0",
                        str(dest.with_suffix(".mp4"))], capture_output=True, text=True)
    try:
        return float(p.stdout.strip() or 0)
    except ValueError:
        return 0.0


# ── the name montage ───────────────────────────────────────────────────────────
def _name_hits(words: list, names: list) -> list:
    """[(start, end)] — where a name (a list of word lists) is said in a word stream."""
    toks = [_norm(w) for _, _, w in words]
    out = []
    for name in names:
        n = len(name)
        for i in range(len(toks) - n + 1):
            if toks[i:i + n] == name:
                out.append((words[i][0], words[i + n - 1][1], i))
    return out


def _sentence_around(words: list, i: int, n_name: int) -> tuple:
    """(start, end, text) — the short sentence the name sits in: out to the nearest breath (a gap of 0.35 s) or
    six words before and ten after, at most 4 seconds."""
    j0 = i
    while j0 > 0 and i - j0 < 6 and words[j0][0] - words[j0 - 1][1] < 0.35:
        j0 -= 1
    j1 = i + n_name - 1
    while j1 + 1 < len(words) and j1 - (i + n_name - 1) < 10 and words[j1 + 1][0] - words[j1][1] < 0.4:
        j1 += 1
    while words[j1][1] - words[j0][0] > 4.0 and j1 > i + n_name - 1:
        j1 -= 1
    while words[j1][1] - words[j0][0] > 4.0 and j0 < i:
        j0 += 1
    return float(words[j0][0]), float(words[j1][1]), " ".join(w for _, _, w in words[j0:j1 + 1])


def _talking(mv, cuts: list) -> set:
    """Which cuts show a person speaking on camera — Claude looks at the middle frame of each."""
    from PIL import Image
    files = []
    for k, (dest, dur, vid, title, text) in enumerate(cuts):
        f = dest.with_name(dest.stem + "_face.jpg")
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-ss", f"{dur * 0.5:.2f}", "-i", str(dest.with_suffix(".mp4")),
                        "-frames:v", "1", "-vf", "scale=800:-2", "-q:v", "4", str(f)], capture_output=True)
        files.append(f)
    if not all(f.exists() for f in files):
        return set()                                       # a frame that cannot be read is not a yes
    try:
        raw = mv.claude_vision(TALKING_PROMPT.replace("[INSERT N HERE]", str(len(files))), files, max_tokens=300)
        m = re.search(r"\{.*\}", raw or "", re.DOTALL)
        d = json.loads(m.group(0)) if m else {}
        idx = lambda key: {int(x) - 1 for x in (d.get(key) or []) if str(x).strip().isdigit() and 1 <= int(x) <= len(files)}
        talking, people = idx("talking"), idx("people")
        # a strict reading leaves a podcast desk out; anyone filmed in a talk setting still belongs in the montage
        return talking if len(talking) >= 3 else (talking | people)
    except Exception as e:                                 # noqa: BLE001 - nothing passes unseen
        _log(mv, f"  soundbites: the on-camera check did not run ({type(e).__name__}) — no cut passes unseen")
        return set()


ON_CAMERA_PROMPT = """These are 3 frames from ONE video clip, in order: frame 1 = the first frame, frame 2 = halfway through,
frame 3 = the last frame. Judge EACH frame on its own. A frame passes when it shows FILMED PEOPLE in a setting where
someone speaks — an interview, a podcast or radio desk (two hosts at microphones count), a studio, a press conference,
a ceremony or a stage, a video call, a news report with the person in shot, a speech at a podium; a wide shot of a desk
or a stage passes. A frame fails when it is game action on the court, a still photograph, an animation, a drawing or a
graphic, a title card or logo screen, a screen recording, or an empty scene with nobody in it. Two frames that look the
same get the same answer.
Answer ONLY with JSON: {"1": {"what": "<three words>", "pass": true|false}, "2": {...}, "3": {...}}"""


def _on_camera(mv, cuts: list) -> dict:
    """{k: (start, middle, end)} — whether each cut shows a filmed person at its first frame, halfway and at its
    last frame. One clip per look, three frames side by side: a single look at the middle frame of a dozen clips
    at once let a show's title graphic and a cut that drifts into B-roll through (and the numbering slipped)."""
    from concurrent.futures import ThreadPoolExecutor

    def one(c):
        dest, got, vid, title, text = c
        files = []
        for j, at in enumerate((0.15, got * 0.5, max(0.15, got - 0.15))):
            f = dest.with_name(f"{dest.stem}_f{j}.jpg")
            subprocess.run(["ffmpeg", "-y", "-v", "error", "-ss", f"{at:.2f}", "-i", str(dest.with_suffix(".mp4")),
                            "-frames:v", "1", "-vf", "scale=800:-2", "-q:v", "4", str(f)], capture_output=True)
            files.append(f)
        if not all(f.exists() for f in files):
            return (False, False, False)                   # a frame that cannot be read is not a yes
        try:
            raw = mv.claude_vision(ON_CAMERA_PROMPT, files, max_tokens=200)
            m = re.search(r"\{.*\}", raw or "", re.DOTALL)
            d = json.loads(m.group(0)) if m else {}
            ok = lambda k: bool((d.get(k) or {}).get("pass")) if isinstance(d.get(k), dict) else False
            return (ok("1"), ok("2"), ok("3"))
        except Exception as e:                             # noqa: BLE001 - nothing passes unseen
            _log(mv, f"  soundbites: the on-camera check did not run ({type(e).__name__}) — the cut does not pass")
            return (False, False, False)

    with ThreadPoolExecutor(max_workers=3) as ex:
        looks = list(ex.map(one, cuts))
    return {k: looks[k] for k in range(len(cuts))}


def montage(mv, subject: str, aliases: list, vids: list, work: Path, most: int, who: str = "") -> list:
    """Quick cuts of different people saying the subject's name to camera: [(dest stem, seconds, video, title, text)].
    Claude chooses the moments (a whole sentence that introduces or praises him first), each cut is checked to show
    a person speaking on camera, one cut per video, up to `most`."""
    full = [_norm(w) for w in subject.split() if _norm(w)]
    names = [full] if len(full) >= 2 else []
    for a in aliases:
        n = [_norm(w) for w in str(a).split() if _norm(w)]
        if n and (len(n) >= 2 or len(n[0]) >= 6) and n not in names:
            names.append(n)
    if not names:
        return []
    moments = []                                          # (video, start, end, text, title)
    for v in vids:
        seen_t = set()
        for a, b, i in _name_hits(v["words"], names):
            if any(abs(a - t) < 6.0 for t in seen_t) or a < 4.0:
                continue
            seen_t.add(a)
            s0, s1, text = _sentence_around(v["words"], i, len(full))
            moments.append((v["id"], s0, s1, text, v.get("title", "")))
            if len(seen_t) >= 3:
                break
    if not moments:
        return []
    rows = "\n".join(f"{k + 1}. [{m[4][:50]}] {_stamp(m[1])}: \"{m[3]}\"" for k, m in enumerate(moments[:40]))
    try:
        ans = mv._json_items(MONTAGE_PROMPT.replace("[INSERT SUBJECT HERE]", who or subject).replace("[INSERT K HERE]", str(most * 3))
                             .replace("[INSERT MOMENTS HERE]", rows), max_tokens=600)
        order = [int(x["n"]) - 1 for x in ans if isinstance(x, dict) and str(x.get("n", "")).strip().isdigit()]
        order = [k for k in order if 0 <= k < len(moments)]
    except (SystemExit, Exception):                        # noqa: BLE001 - the cleanest mentions, by ear
        order = list(range(min(len(moments), most * 3)))
    cuts, used = [], set()
    for k in order:
        if len(cuts) >= most * 2:
            break
        vid, a, b, text, title = moments[k]
        if vid in used:
            continue
        lo, hi = max(0.0, a - NAME_PAD[0]), b + NAME_PAD[1]
        hi = min(hi, lo + MONTAGE_CLIP[1])
        if hi - lo < MONTAGE_CLIP[0]:
            hi = lo + MONTAGE_CLIP[0]
        dest = work / "montage" / f"say_{k:02d}"
        try:
            got = cut(vid, lo, hi, dest, work, zoom=1.14)
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError):
            got = 0.0
        if got >= 1.0:
            used.add(vid)
            cuts.append((dest, got, vid, title, text))
    if not cuts:
        return []
    looks = _on_camera(mv, cuts)
    # the middle and the last frame have to show a filmed person; a cut that drifts into B-roll or a photo at its
    # end is cut back to three quarters and looked at again; a cut that opens on the show's title graphic is cut
    # back to just before the name (below) and looked at again
    for k, c in enumerate(cuts):
        if looks[k][0] and looks[k][1] and not looks[k][2]:
            dest, got, vid, title, text = c
            m = next((mm for mm in moments if mm[0] == vid), None)
            shorter = round(got * 0.75, 2)
            if m is None or shorter < MONTAGE_CLIP[0]:
                continue
            lo = max(0.0, m[1] - NAME_PAD[0])
            try:
                got2 = cut(vid, lo, lo + shorter, dest, work, zoom=1.14)
            except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError):
                got2 = 0.0
            if got2 >= MONTAGE_CLIP[0] and _talking(mv, [(dest, max(0.3, 2 * (got2 - 0.15)), vid, title, text)]):
                cuts[k] = (dest, got2, vid, title, text)
                looks[k] = (True, True, True)
                _log(mv, f"  soundbites: montage cut from {title[:40]!r} drifted away at its end — cut to {got2:.1f} s")
    out = [c for k, c in enumerate(cuts) if looks[k][1] and looks[k][2]][:most]
    starts = {k for k, c in enumerate(out) if looks[cuts.index(c)][0]}
    trimmed = []
    for k, c in enumerate(out):
        if k in starts:
            trimmed.append(c)
            continue
        dest, got, vid, title, text = c
        m = next((mm for mm in moments if mm[0] == vid), None)
        if m is None:
            continue
        lo2 = max(0.0, m[1] - 0.25)
        for a, b, i in _name_hits(next(v["words"] for v in vids if v["id"] == vid), names):
            if abs(a - m[1]) < 6.0:
                lo2 = max(0.0, a - 0.25)
                break
        hi2 = lo2 + max(MONTAGE_CLIP[0], min(got - (lo2 - max(0.0, m[1] - NAME_PAD[0])), MONTAGE_CLIP[1]))
        try:
            got2 = cut(vid, lo2, hi2, dest, work, zoom=1.14)
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError):
            got2 = 0.0
        if got2 >= 1.0 and _talking(mv, [(dest, 0.3, vid, title, text)]):
            trimmed.append((dest, got2, vid, title, text))
            _log(mv, f"  soundbites: montage cut from {title[:40]!r} opened on a graphic — trimmed to the name")
        else:
            _log(mv, f"  soundbites: montage cut from {title[:40]!r} still opens on a graphic — left out")
    out = trimmed
    if not out:
        # Robin's rule: the opening is real people saying the name on camera, or nothing — never a cut that failed
        _log(mv, f"  soundbites: none of the {len(cuts)} cut(s) shows a person on camera all the way — no name montage")
        return []
    for dest, got, vid, title, text in out:
        _log(mv, f"  soundbites: montage — {title[:44]!r}: \"{text[:60]}\"")
    if len(out) < len(cuts):
        _log(mv, f"  soundbites: {len(cuts) - len(out)} cut(s) left out — not a person speaking on camera")
    return out


def _join_montage(parts: list, dest: Path, name: str) -> float:
    """The montage cuts joined — a hard cut between them, the subject's name in a box over the last one, and the
    picture and sound fading out over the last half second so the film can breathe before the first word."""
    lst = dest.with_suffix(".txt")
    lst.write_text("".join(f"file '{p.with_suffix('.mp4').as_posix()}'\n" for p, _, _, _, _ in parts), encoding="utf-8")
    alst = dest.with_name(dest.stem + "_a.txt")
    alst.write_text("".join(f"file '{p.with_suffix('.wav').as_posix()}'\n" for p, _, _, _, _ in parts), encoding="utf-8")
    total = sum(d for _, d, _, _, _ in parts)
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", str(alst), "-af",
                    f"afade=t=out:st={max(0.0, total - 0.6):.3f}:d=0.6", "-c:a", "pcm_s16le",
                    str(dest.with_suffix(".wav"))], check=True, capture_output=True)
    font = HERE / "assets" / "fonts" / "InterDisplay-Black.ttf"
    at = max(0.3, total - parts[-1][1] + 0.15)
    label = name.upper().replace("'", "").replace(":", "")
    draw = (f",drawtext=fontfile='{font.as_posix().replace(chr(58), chr(92) + chr(58))}':text='{label}':fontsize=84:fontcolor=white:"
            f"box=1:boxcolor=0xF26D21@0.96:boxborderw=22:x=(w-text_w)/2:y=h*0.62:enable='gte(t,{at:.2f})'") if font.exists() else ""
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", str(lst), "-vf",
                    f"fps={FPS},format=yuv420p{draw},fade=t=out:st={max(0.0, total - 0.5):.3f}:d=0.5"] + ENC +
                   ["-an", str(dest.with_suffix(".mp4"))], check=True, capture_output=True)
    lst.unlink(missing_ok=True)
    alst.unlink(missing_ok=True)
    return total


# ── sound-ups: the footage speaks for itself ───────────────────────────────────
SOUNDUP_PROMPT = """You are cutting the cold open of a sports documentary about [INSERT SUBJECT HERE]. The narration of the
first minute:

"[INSERT HOOK HERE]"

Between its sentences the film breathes: a real clip plays with ITS OWN SOUND — a dunk with the arena roaring, a
buzzer, a trophy lift, a fight, a coach screaming, a crowd chanting — 1.6 to 2.8 seconds, then the narration goes
on. Below are shots the footage watcher logged in the videos found for this story, with their seconds.

Choose up to [INSERT K HERE], best first, from DIFFERENT videos: the moments where the footage itself carries emotion
and where its sound will carry (a game broadcast, an arena, a ceremony). Never a talking head, an interview, a
studio, a still photo, a graphic, a title, music-only montage. Give the exact seconds inside the shot (end - start
between 1.6 and 2.8).
Return ONLY a JSON array: [{"video": "id", "start": 83.2, "end": 85.6, "why": "one short line"}, ...]

[INSERT SHOTS HERE]"""


def _mmss(v) -> float:
    try:
        parts = str(v).split(":")
        return float(parts[-1]) + 60 * float(parts[-2]) if len(parts) > 1 else float(parts[0])
    except (ValueError, TypeError):
        return 0.0


def soundups(mv, subject: str, job: Path, srt: Path, work: Path, most: int, who: str = "") -> list:
    """[(dest stem, seconds, video id, why)] — up to `most` footage moments cut WITH their sound for the hook, chosen
    by Claude from the shot logs (youtube/catalog). Nothing when the logs hold no electric moment."""
    import youtube
    logs = []
    for f in sorted((job / "youtube" / "catalog").glob("*.json")) if (job / "youtube" / "catalog").is_dir() else []:
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        vid = str(d.get("id") or f.stem)
        for sh in d.get("shots") or []:
            a, b = _mmss(sh.get("start")), _mmss(sh.get("end"))
            # the same bar the footage pick sets: no captions or titles burned over the picture, no watermark, no
            # compilation with its own subtitles — a sound-up is the raw moment
            if (b - a < 1.8 or str(sh.get("kind") or "") not in ("archive", "event", "game", "news", "modern")
                    or int(sh.get("quality") or 0) < 3 or str(sh.get("text") or "none") not in ("none", "small")):
                continue
            logs.append((vid, str(d.get("video") or "")[:70], a, b, str(sh.get("shows") or "")[:120], str(sh.get("kind") or "")))
    if not logs:
        return []
    logs = logs[:160]
    try:
        entries = mv._parse_srt_full(srt.read_text(encoding="utf-8"))
    except (OSError, AttributeError):
        entries = []
    hook = " ".join(e[2] for e in entries if float(e[0]) < 60.0)
    rows = "\n".join(f"{vid} [{title}] {a:.1f}-{b:.1f}s ({kind}): {shows}" for vid, title, a, b, shows, kind in logs)
    try:
        ans = mv._json_items(SOUNDUP_PROMPT.replace("[INSERT SUBJECT HERE]", who or subject).replace("[INSERT HOOK HERE]", hook[:1200])
                             .replace("[INSERT K HERE]", str(most)).replace("[INSERT SHOTS HERE]", rows), max_tokens=500)
    except (SystemExit, Exception):                        # noqa: BLE001
        return []
    out, used = [], set()
    for x in ans if isinstance(ans, list) else []:
        if not isinstance(x, dict) or not x.get("video") or str(x["video"]) in used:
            continue
        try:
            a, b = float(x.get("start")), float(x.get("end"))
        except (TypeError, ValueError):
            continue
        b = min(b, a + 2.8)
        if b - a < 1.4:
            b = a + 1.8
        dest = work / f"soundup_{len(out):02d}"
        try:
            got = cut(str(x["video"]), a, b, dest, work, zoom=1.0)
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError):
            got = 0.0
        if got < 1.2:
            continue
        used.add(str(x["video"]))
        out.append((dest, got, str(x["video"]), str(x.get("why") or "")))
        if len(out) >= most:
            break
    return out


def _sentence_ends(mv, srt: Path, lo: float, hi: float) -> list:
    """The seconds where a sentence ends in the narration between lo and hi: from the heard words (they carry the
    script's punctuation), else from the subtitle cues."""
    out = []
    try:
        heard = json.loads((srt.parent / "words_heard.json").read_text(encoding="utf-8"))
        out = [float(w[2]) for w in heard if len(w) >= 3 and re.search(r"[.!?…]$", str(w[0]).strip()) and lo <= float(w[2]) <= hi]
    except (OSError, ValueError, TypeError, IndexError):
        out = []
    if out:
        return out
    try:
        entries = mv._parse_srt_full(srt.read_text(encoding="utf-8"))
    except (OSError, AttributeError):
        return []
    return [float(e[1]) for e in entries if lo <= float(e[1]) <= hi and re.search(r"[.!?…]\s*$", str(e[2]).strip())]


# ── the interview quotes ────────────────────────────────────────────────────────
def quote(mv, subject: str, want: dict, vids: list, work: Path, max_s: float, k: int, who: str = "") -> tuple:
    """One interview clip that says what the script wants: (dest stem, seconds, video id) or None."""
    import youtube
    extra = search(f"{subject} {want.get('what', '')}"[:90], 5)
    seen = {v["id"] for v in vids}
    more = _about(mv, [v for v in extra if v["id"] not in seen and 40 <= float(v.get("duration") or 0) <= 3600][:5], who)[:3]
    with ThreadPoolExecutor(max_workers=3) as ex:
        got = list(ex.map(lambda v: words_of(v["id"], work), more))
    pool = vids + [dict(v, words=w) for v, w in zip(more, got) if len(w) >= 40]
    if not pool:
        return None
    blocks = []
    for v in pool[:8]:
        lines = _lines(v["words"])
        if len(lines) > 220:
            # a long video: the stretches whose words touch the request, with room around them
            keys = {_norm(w) for w in re.findall(r"[a-zA-Z']+", want.get("what", "")) if len(w) > 3}
            score = [sum(1 for w in txt.split() if _norm(w) in keys) for _, txt in lines]
            keep = set()
            for i, sc in enumerate(score):
                if sc:
                    keep.update(range(max(0, i - 25), min(len(lines), i + 25)))
            lines = [ln for i, ln in enumerate(lines) if i in keep] or lines[:220]
        blocks.append(f"VIDEO {v['id']} — {v.get('title', '')[:80]}\n" +
                      "\n".join(f"  [{_stamp(t)}] {txt}" for t, txt in lines[:260]))
    prompt = (PICK_PROMPT.replace("[INSERT SUBJECT HERE]", who or subject).replace("[INSERT CONTEXT HERE]", str(want.get("after") or ""))
              .replace("[INSERT WHAT HERE]", str(want.get("what") or "")).replace("[INSERT MAX HERE]", f"{max_s:.0f}")
              .replace("[INSERT VIDEOS HERE]", "\n\n".join(blocks)))
    try:
        ans = mv._json_items(prompt, max_tokens=600)
    except SystemExit:
        return None
    picks = [x for x in ans if isinstance(x, dict) and x.get("video")][:3]
    if not picks:
        return None
    chosen = None
    for n, pick in enumerate(picks):
        v = next((x for x in pool if x["id"] == str(pick["video"])), None)
        if v is None:
            continue
        a, b = _span(v["words"], str(pick.get("first_words") or ""), str(pick.get("last_words") or ""))
        if a is None:
            continue
        if b - a > max_s:
            b = a + max_s
        dest = work / f"quote_{k:02d}_{n}"
        lo = max(0.0, a - QUOTE_PAD[0])
        try:
            got = cut(v["id"], lo, b + QUOTE_PAD[1], dest, work)
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError):
            got = 0.0
        if got < 1.2:
            continue
        # the clip has to SHOW the person speaking all the way through: a documentary's voice over old photos is
        # not an interview, and a talking head that drifts into B-roll is cut where it drifts
        look = _on_camera(mv, [(dest, got, v["id"], v.get("title", ""), "")])[0]
        if look[0] and look[1] and not look[2]:
            shorter = round(got * 0.72, 2)
            if shorter >= 3.0 and _talking(mv, [(dest, max(0.3, 2 * (shorter - 0.15)), v["id"], v.get("title", ""), "")]):
                try:
                    got = cut(v["id"], lo, lo + shorter, dest, work)
                    b = min(b, lo + shorter - QUOTE_PAD[1])
                    _log(mv, f"  soundbites: clip {k} candidate {n + 1} drifts into B-roll — cut to {got:.1f} s")
                except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError):
                    got = 0.0
                look = (True, True, got > 0)
        if not (look[0] and look[1] and look[2]):
            _log(mv, f"  soundbites: clip {k} candidate {n + 1} is not a person on camera — next")
            continue
        chosen = (v, a, b, dest, lo, got, pick)
        break
    if chosen is None:
        return None
    v, a, b, dest, lo, got, pick = chosen
    # what is said, in lines of a few words, on the clip's own clock (the captions quote them)
    lines, cur, t0 = [], [], None
    for wa, wb, w in v["words"]:
        if wa < a - 0.05 or wa > b + 0.05:
            continue
        if not cur:
            t0 = wa
        cur.append(w)
        if len(cur) >= 7 or re.search(r"[.!?,]$", w):
            lines.append([round(t0 - lo, 3), round(wb - lo, 3), " ".join(cur)])
            cur = []
    if cur:
        lines.append([round(t0 - lo, 3), round(min(b, t0 + 3.0) - lo, 3), " ".join(cur)])
    _log(mv, f"  soundbites: clip {k} — {v.get('title', '')[:50]!r} {_stamp(a)}-{_stamp(b)}: {pick.get('why', '')}")
    return dest, got, v["id"], lines


# ── moments of a broadcast (another language, found by watching) ──────────────
BROADCAST_PROMPT = """You are cutting a documentary. Find in this video the moment described here:

"[INSERT WHAT HERE]"

It must play with its OWN ORIGINAL SOUND: the broadcast itself — its anchor, announcer or speaker talking, or its
own music — with nobody else (no reporter, narrator, translator or interviewer) talking over it, and it must be
that very moment, not a different broadcast that merely looks alike. The PICTURE must be the broadcast too: no
reporter's graphics, no split screen — the broadcaster's own logo and its own on-screen text are fine, and
subtitles someone else burned in are tolerated only in a band at the bottom or the top (they will be cropped
off). Choose ONE continuous stretch of
[INSERT MIN HERE] to [INSERT MAX HERE] seconds that starts where a sentence starts and ends where one ends — the
most recognisable part of that moment. The picture must stay on that broadcast's own images for the whole stretch:
an uploader's cut-away to other footage (another year, another event) under the sound is not allowed, so pick a
shorter stretch that has none.

ALL TIMES are strings "MM:SS.s" from the start of the video.
Return ONLY JSON:
{"found": true or false, "start": "MM:SS.s", "end": "MM:SS.s",
 "shows": "what is on screen, at most 20 words",
 "voiceover": true or false (is anyone other than the broadcast itself heard in the stretch),
 "overlay": "another channel's logo or watermark in a corner — or empty",
 "subtitles": "none", "bottom", "top" or "middle" (where captions or subtitles that are NOT the broadcaster's
   own are burned into the picture during the stretch),
 "cutaway": true or false (the picture cuts away to other footage within the stretch),
 "lines": [{"start": "MM:SS.s", "end": "MM:SS.s", "english": "what is said, in English — word for word when it is spoken in
   English, an accurate translation otherwise; names, brands and places spelled as in the description above (a
   "Roland" is never "rolling")"}] — ONLY words someone actually says: when the stretch is music, applause or
   ambient sound, "lines" is an empty array. Never describe the picture there: the lines are shown on screen in
   quotation marks as the speaker's own words,
 "sure": 1 to 5 (5 = certain this is exactly the moment described)}"""

TRANSLATE_PROMPT = """Translate these subtitle lines of a [INSERT FROM HERE] broadcast into natural [INSERT LANG HERE] for a
documentary. Keep the meaning and the tone exactly (official, solemn, triumphant — whatever it is), keep every
line short, do not add or drop information.
Return ONLY a JSON array with one object per line, in the same order: [{"t": "..."}]

[INSERT LINES HERE]"""


def _active_area(sec: Path, start: float, length: float) -> str:
    """"crop=w:h:x:y," for the picture inside black bars (ffmpeg cropdetect over the stretch), or "" when the
    picture already fills the frame."""
    try:
        p = subprocess.run(["ffmpeg", "-v", "info", "-nostdin", "-ss", f"{start:.2f}", "-t", f"{max(1.0, length):.2f}",
                            "-i", str(sec), "-an", "-vf", "cropdetect=limit=24:round=2:reset=0", "-f", "null", "-"],
                           capture_output=True, text=True, timeout=120)
        q = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
                            "-of", "csv=p=0", str(sec)], capture_output=True, text=True, timeout=60)
        fw, fh = [int(x) for x in q.stdout.strip().split(",")[:2]]
    except (subprocess.TimeoutExpired, OSError, ValueError):
        return ""
    found = re.findall(r"crop=(\d+):(\d+):(\d+):(\d+)", p.stderr)
    if not found:
        return ""
    w, h, x, y = [int(v) for v in found[-1]]
    if w < fw * 0.4 or h < fh * 0.4 or (w >= fw * 0.94 and h >= fh * 0.94):
        return ""
    return f"crop={w}:{h}:{x}:{y},"


CLEAN_PROMPT = """These are three frames of a clip that a documentary will show full screen, quoting in its own subtitles
what is said. The clip should show: [INSERT WHAT HERE]

Is the picture unusable? It is when: subtitles or captions in any language were burned in by someone other than the
original broadcaster (a news outlet's translation, a YouTuber's captions); a reporter, presenter or studio of a
DIFFERENT channel is on screen; any logo or watermark of another channel that is not one small mark tucked in a
corner (two or more marks, or one over the picture, means unusable); any line or fragment of text along the bottom
or top edge that the original broadcast would not carry; or it is plainly not the moment described. The original
broadcaster's own logo, clock or on-screen text is fine, and so is ONE small agency credit in a corner.
Return ONLY JSON: [{"unusable": true or false, "why": "one short reason"}]"""


def _clean_picture(mv, mp4: Path, dur: float, what: str) -> str:
    """"" when the clip's picture can go on screen, else why not — Claude looks at three frames."""
    frames = []
    for i, t in enumerate((0.15, 0.5, 0.85)):
        f = mp4.with_name(f"{mp4.stem}_look{i}.jpg")
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-nostdin", "-ss", f"{dur * t:.2f}", "-i", str(mp4),
                        "-frames:v", "1", "-vf", "scale=960:-2", str(f)], capture_output=True)
        if f.exists():
            frames.append(f)
    if not frames:
        return "no frames"
    try:
        text = mv.claude_vision(CLEAN_PROMPT.replace("[INSERT WHAT HERE]", what[:300]), [str(f) for f in frames],
                                max_tokens=300)
        import youtube
        d = youtube._json_in(text)
        d = d[0] if isinstance(d, list) and d else d
        return str(d.get("why") or "not usable") if isinstance(d, dict) and d.get("unusable") else ""
    except Exception:                                      # noqa: BLE001 - the watcher's own word stands
        return ""


def _snap_to_pauses(sec: Path, start: float, length: float, have: float) -> tuple:
    """(start, length) with each edge moved to the nearest pause within 0.9 s: the start to where a silence ends,
    the end to where one begins. Unchanged where the sound has no pause there (music under the whole stretch)."""
    try:
        p = subprocess.run(["ffmpeg", "-v", "info", "-nostdin", "-i", str(sec), "-vn", "-af",
                            "silencedetect=noise=-32dB:d=0.18", "-f", "null", "-"], capture_output=True, text=True, timeout=120)
    except (subprocess.TimeoutExpired, OSError):
        return start, length
    ends = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", p.stderr)]
    begs = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", p.stderr)]
    end = start + length
    near_a = [e for e in ends if abs(e - start) <= 0.9]
    near_b = [g for g in begs if abs(g - end) <= 0.9 and g > start + 1.5]
    a2 = max(0.0, min(near_a, key=lambda e: abs(e - start)) - 0.12) if near_a else start
    b2 = min(have, min(near_b, key=lambda g: abs(g - end)) + 0.18) if near_b else end
    return (a2, b2 - a2) if b2 - a2 >= 1.5 else (start, length)


def _translate_lines(mv, lines: list, lang: str) -> list:
    """The clip's English lines in the channel's language; the English stays when the translation fails."""
    if not lines or not lang or lang.lower().startswith("english"):
        return lines
    body = "\n".join(f"{i + 1}. {ln[2]}" for i, ln in enumerate(lines))
    try:
        got = mv._json_items(TRANSLATE_PROMPT.replace("[INSERT FROM HERE]", "foreign").replace("[INSERT LANG HERE]", lang)
                             .replace("[INSERT LINES HERE]", body), max_tokens=900)
    except (SystemExit, Exception):                        # noqa: BLE001 - English beats no quote
        return lines
    out = [x.get("t") if isinstance(x, dict) else x for x in got]
    if len(out) != len(lines) or not all(isinstance(t, str) and t.strip() for t in out):
        return lines
    return [[a, b, t.strip()] for (a, b, _), t in zip(lines, out)]


def _split_long(lines: list, most: int = 52) -> list:
    """A line too long for one row under the picture becomes several, each on its share of the seconds."""
    out = []
    for a, b, t in lines:
        words = t.split()
        if len(t) <= most or len(words) < 2:
            out.append([a, b, t])
            continue
        half, acc = len(t) / 2, 0
        for i, w in enumerate(words[:-1]):
            acc += len(w) + 1
            if acc >= half:
                break
        one, two = " ".join(words[:i + 1]), " ".join(words[i + 1:])
        mid = round(a + (b - a) * len(one) / max(1, len(t)), 3)
        out += _split_long([[a, mid, one], [mid, b, two]], most)
    return out


_WHISPER = None


def _spoken_words(wav: Path) -> int:
    """How many words a speech recogniser hears in a clip once music and noise are filtered out (voice activity
    detection) — 99 when it cannot tell, so a missing recogniser never throws real quotes away."""
    global _WHISPER
    try:
        from faster_whisper import WhisperModel
        if _WHISPER is None:
            _WHISPER = WhisperModel("small", device="cpu", compute_type="int8")
        segs, _ = _WHISPER.transcribe(str(wav), vad_filter=True, vad_parameters={"min_speech_duration_ms": 300})
        return sum(len(x.text.split()) for x in segs if x.no_speech_prob < 0.6)
    except Exception:                                      # noqa: BLE001
        return 99


def _watch_broadcast(url: str, prompt: str) -> dict:
    """The video model's answer for one YouTube video: Gemini's own API first (free tier), OpenLux next."""
    import youtube
    last = None
    for relay in ((False, True) if youtube._env("GEMINI_API_KEY") else (True,)):
        if relay and (not youtube._env("OPENLUX_API_KEY") or not youtube._allowed(["openlux"])):
            continue
        if not relay and not youtube._allowed(["gemini"]):
            continue
        try:
            d = youtube._json_in(youtube._gemini_log(url, prompt, relay=relay))
            if isinstance(d, dict):
                return d
        except Exception as e:                             # noqa: BLE001 - the next watcher may answer
            last = e
    raise last or RuntimeError("no GEMINI_API_KEY or OPENLUX_API_KEY for watching a broadcast")


QUERY_PROMPT = """A documentary needs a real clip of this broadcast moment, with its original sound:

"[INSERT WHAT HERE]"

Write 3 YouTube searches that would find a video containing it: short (3 to 8 words), the words a news channel or
an uploader would put in the title — the first in English, the second in English with the year, the third in the
broadcast's own language (e.g. Korean for North Korean TV). Return ONLY a JSON array of 3 strings."""


def _bcast_queries(mv, what: str, work: Path) -> list:
    """Short YouTube searches for a described moment — a long description finds nothing. Cached per moment."""
    f = work / "queries.json"
    try:
        known = json.loads(f.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        known = {}
    if what in known:
        return known[what]
    qs = []
    try:
        got = mv._json_items(QUERY_PROMPT.replace("[INSERT WHAT HERE]", what), max_tokens=300)
        qs = [str(x).strip() for x in got if isinstance(x, str) and 2 <= len(str(x).split()) <= 10][:3]
    except (SystemExit, Exception):                        # noqa: BLE001 - the plain words below
        qs = []
    if not qs:
        core = re.sub(r"\([^)]*\)|,.*$", "", what)
        qs = [" ".join(core.split()[:8])]
    known[what] = qs
    try:
        f.write_text(json.dumps(known, ensure_ascii=False, indent=1), encoding="utf-8")
    except OSError:
        pass
    return qs


def broadcast_clip(mv, want: dict, work: Path, max_s: float, k: int, lang: str) -> tuple:
    """One moment of a broadcast with its own sound, for a [[clip: …]] line: (dest stem, seconds, video id, lines)
    or None. The script names the moment in English (who says what, where, when); YouTube is searched for it, a
    video model watches the shortest candidates with their sound and points at the stretch, the edges are snapped to
    the pauses, and what is said is quoted under the picture in the channel's language."""
    import youtube
    what = re.sub(r"\s+", " ", str(want.get("what") or "")).strip()
    if not what:
        return None
    seen, cands = set(), []
    # videos the job names for its clips (soundbites/seeds.json: [{"id", "title"}]) come first, the ones whose
    # titles share the most words with the request
    try:
        seeds = json.loads((work / "seeds.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        seeds = []
    keys = {_norm(w) for w in re.findall(r"[\w'-]+", what) if len(w) > 3}
    ranked = sorted(((sum(1 for w in re.findall(r"[\w'-]+", str(x.get("title") or "")) if _norm(w) in keys), x)
                     for x in seeds if isinstance(x, dict) and x.get("id")), key=lambda t: -t[0])
    exact = [x for x in seeds if isinstance(x, dict) and x.get("id") and _norm(str(x.get("what") or "")) == _norm(what)]
    for x in exact:                                        # a video already known to hold this very moment
        if x["id"] not in seen:
            seen.add(x["id"])
            cands.append({"id": x["id"], "title": str(x.get("title") or ""), "duration": float(x.get("duration") or 300),
                          "seed": True})
    for score, x in ranked[:3]:
        if score >= 2 and x["id"] not in seen:
            seen.add(x["id"])
            cands.append({"id": x["id"], "title": str(x.get("title") or ""), "duration": float(x.get("duration") or 300),
                          "seed": True})
    for q in _bcast_queries(mv, what, work):
        for v in search(q, 6):
            d = float(v.get("duration") or 0)
            if v["id"] not in seen and 15 <= d <= 1500:
                seen.add(v["id"])
                cands.append(v)
    cands.sort(key=lambda v: (not v.get("seed"), float(v.get("duration") or 0) > 480))   # seeds, then short videos
    prompt = (BROADCAST_PROMPT.replace("[INSERT WHAT HERE]", what).replace("[INSERT MIN HERE]", "4")
              .replace("[INSERT MAX HERE]", f"{max_s:.0f}"))
    for n, v in enumerate(cands[:8]):
        try:
            ans = _watch_broadcast(youtube._watch_url(v["id"]), prompt)
        except Exception as e:                             # noqa: BLE001
            _log(mv, f"  soundbites: clip {k} — {v['id']} not watched ({str(e)[:80]})")
            continue
        try:
            sure = float(ans.get("sure") or 0)
        except (TypeError, ValueError):
            sure = 0.0
        subs_at = str(ans.get("subtitles") or "none").strip().lower()
        subs_at = "none" if subs_at in ("false", "no", "") else ("middle" if subs_at == "true" else subs_at)
        if (not ans.get("found") or ans.get("voiceover") is True or ans.get("cutaway") is True or subs_at == "middle"
                or sure < 4):
            _log(mv, f"  soundbites: clip {k} candidate {n + 1} {v['id']} passed over — found {bool(ans.get('found'))}, "
                     f"voice-over {ans.get('voiceover')}, cut-away {ans.get('cutaway')}, subtitles {ans.get('subtitles')}, "
                     f"sure {sure:.0f}: "
                     f"{str(ans.get('shows') or '')[:60]}")
            continue
        a, b = _mmss(ans.get("start")), _mmss(ans.get("end"))
        if not 0 <= a < b:
            continue
        b = min(b, a + max_s)
        if b - a < 2.5:
            continue
        dest = work / f"bcast_{k:02d}_{n}"
        try:
            # another channel's corner logo is pushed out of frame by a slight zoom
            got = cut(v["id"], a, b, dest, work, zoom=1.1 if str(ans.get("overlay") or "").strip() else 1.0, snap=True,
                      debar=True, band=subs_at if subs_at in ("bottom", "top") else "")
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError):
            got = 0.0
        if got < 2.0:
            continue
        why = _clean_picture(mv, dest.with_suffix(".mp4"), got, what)
        if why:
            _log(mv, f"  soundbites: clip {k} candidate {n + 1} refused — {why[:90]}")
            continue
        lines = []
        for ln in ans.get("lines") or []:
            if not isinstance(ln, dict):
                continue
            la, lb, text = _mmss(ln.get("start")) - a, _mmss(ln.get("end")) - a, str(ln.get("english") or "").strip()
            if text and lb > 0.3 and la < got - 0.3:
                lines.append([round(max(0.0, la), 3), round(min(got, max(lb, la + 1.0)), 3), text])
        if lines and _spoken_words(dest.with_suffix(".wav")) < 3:
            # nobody really speaks in it (the anthem, applause): what came back describes the picture, and a
            # description in quotation marks would put words in someone's mouth
            _log(mv, f"  soundbites: clip {k} has no speech — no quoted lines")
            lines = []
        lines = _split_long(_translate_lines(mv, lines, lang))
        _log(mv, f"  soundbites: clip {k} — {v.get('title', '')[:50]!r} {_stamp(a)}-{_stamp(b)} ({got:.1f} s): "
                 f"{str(ans.get('shows') or '')[:70]}")
        return dest, got, v["id"], lines
    return None


def _span(words: list, first: str, last: str):
    """(start, end) seconds of the stretch that begins with `first` and ends with `last`, or (None, None)."""
    toks = [_norm(w) for _, _, w in words]
    f = [_norm(w) for w in first.split() if _norm(w)][:5]
    l = [_norm(w) for w in last.split() if _norm(w)][-5:]
    if not f or not l:
        return None, None

    def find(seq, from_i=0):
        n = len(seq)
        for i in range(from_i, len(toks) - n + 1):
            if toks[i:i + n] == seq:
                return i
        # allow one word off
        for i in range(from_i, len(toks) - n + 1):
            if sum(1 for x, y in zip(toks[i:i + n], seq) if x == y) >= max(2, n - 1):
                return i
        return -1
    i = find(f)
    if i < 0:
        return None, None
    j = find(l, i)
    if j < 0 or j < i:
        j = min(len(toks) - len(l), i + 40)
    return float(words[i][0]), float(words[j + len(l) - 1][1])


# ── the whole pass ─────────────────────────────────────────────────────────────
def _subject(mv, job: Path) -> tuple:
    f = job / "soundbites" / "subject.json"
    if f.exists():
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
            return d["subject"], d.get("aliases") or []
        except (OSError, ValueError, KeyError):
            pass
    title = (job / "title.txt").read_text(encoding="utf-8").splitlines()[0] if (job / "title.txt").exists() else ""
    script = (job / "script.txt").read_text(encoding="utf-8") if (job / "script.txt").exists() else ""
    ans = mv._json_items(SUBJECT_PROMPT.replace("[INSERT TITLE HERE]", title)
                         .replace("[INSERT OPENING HERE]", " ".join(script.split()[:220])), max_tokens=300)
    d = next((x for x in ans if isinstance(x, dict) and x.get("subject")), None)
    if not d:
        return "", []
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(json.dumps(d, ensure_ascii=False), encoding="utf-8")
    return str(d["subject"]), [str(a) for a in (d.get("aliases") or [])]


def after_voice(mv, job: Path, mp3: Path, srt: Path, style: str) -> bool:
    """Interview clips and the name montage cut into the voice. Returns True when the voice was changed."""
    import cinema
    cfg = settings(mv, style)
    if not cfg["on"]:
        return False
    work = job / "soundbites"
    done = work / "applied.json"
    sig = f"{mp3.stat().st_size}:{int(mp3.stat().st_mtime)}"
    if done.exists():
        try:
            if json.loads(done.read_text(encoding="utf-8")).get("sig") == sig:
                return False
        except (OSError, ValueError):
            pass
    wanted = []
    if (job / "clips_wanted.json").exists():
        try:
            wanted = json.loads((job / "clips_wanted.json").read_text(encoding="utf-8"))[:cfg["quotes"]]
        except (OSError, ValueError):
            wanted = []
    broadcast = cfg["broadcast"]
    if not wanted and (broadcast or not cfg["montage"]):
        return False
    lang = str(((getattr(mv, "STYLE_INFO", {}) or {}).get(style) or {}).get("language") or "English")
    if broadcast:
        subject, aliases, who, vids = "", [], "", []
        work.mkdir(parents=True, exist_ok=True)
        _log(mv, f"soundbites: looking for {len(wanted)} broadcast moment(s) that play with their own sound...")
    else:
        subject, aliases = _subject(mv, job)
        if not subject:
            _log(mv, "soundbites: no subject found in the script — no clips")
            return False
        work.mkdir(parents=True, exist_ok=True)
        _log(mv, f"soundbites: looking for {subject!r} on camera ({len(wanted)} clip(s) wanted"
                 f"{', and a name montage' if cfg['montage'] else ''})...")
        who = _who(job, subject)
        vids = _candidates(mv, subject, [w.get("what", "") for w in wanted], work, who)
    rows, cuts = [], []
    if cfg["montage"] and cfg["montage_max"] > 0 and not broadcast:
        try:
            parts = montage(mv, subject, aliases, vids, work, cfg["montage_max"], who)
            if len(parts) >= 2:
                dest = work / "montage"
                total = _join_montage(parts, dest, subject)
                # the sentences said in the montage, as lines the captions can quote
                lines, t_acc = [], 0.0
                for p_, d_, _v, _t, text in parts:
                    if len(text.split()) >= 4:
                        lines.append([round(t_acc + 0.1, 3), round(t_acc + d_ - 0.15, 3), text])
                    t_acc += d_
                rows.append({"kind": "montage", "t": 0.0, "dur": round(total, 3), "mp4": str(dest.with_suffix(".mp4")),
                             "wav": str(dest.with_suffix(".wav")), "videos": [p[2] for p in parts], "lines": lines})
                cuts.append((0.0, total + 0.5))
                # a hit on the first frame and on every cut; the riser climbs into the last cut and lands as the name does
                starts = [round(sum(d for _, d, _, _, _ in parts[:i]), 3) for i in range(len(parts))]
                marks = [[0.0, "hit_file", -3.0]] + [[st, "hit", -6.0] for st in starts[1:]]
                marks += [[max(0.0, starts[-1] - 0.2), "riser_file", -5.0], [round(starts[-1] + 0.15, 3), "hit_file", -2.0]]
                dest.with_suffix(".sfx.json").write_text(json.dumps(marks), encoding="utf-8")
        except Exception as e:                                # noqa: BLE001
            _log(mv, f"  soundbites: no montage — {type(e).__name__}: {str(e)[:120]}")
    heard_f = job / "words_heard.json"
    heard = [list(x) for x in json.loads(heard_f.read_text(encoding="utf-8"))] if heard_f.exists() else []
    pos = 0
    for k, want in enumerate(wanted):
        try:
            got = (broadcast_clip(mv, want, work, cfg["max_s"], k, lang) if broadcast
                   else quote(mv, subject, want, vids, work, cfg["max_s"], k, who))
        except Exception as e:                                # noqa: BLE001
            _log(mv, f"  soundbites: clip {k} skipped — {type(e).__name__}: {str(e)[:120]}")
            got = None
        if not got:
            _log(mv, f"  soundbites: nothing on camera for {want.get('what', '')!r}")
            continue
        dest, dur, vid, lines = got
        at = cinema._lead_in_captions(mv, job, srt, want.get("lead", ""), 0.0)
        i = cinema._heard_at(heard, at, pos) if at is not None and heard else -1
        if i <= 0 and heard:
            i = cinema._find_lead(heard, want.get("lead", ""), pos)
        if i <= 0:
            _log(mv, f"  soundbites: clip {k} has no place in the voice ({want.get('lead', '')[:40]!r})")
            continue
        cut_at = cinema._cut_between(heard, i)
        # a clip written right before a chapter heading lands inside the chapter's own pause: it goes in front of the
        # chapter instead, and the chapter (card and all) moves after it
        try:
            for ch in json.loads((job / "chapters.json").read_text(encoding="utf-8")):
                if ch.get("t") is not None and float(ch["t"]) - 0.3 <= cut_at <= float(ch["t"]) + float(ch.get("pause") or 1.6) + 0.3:
                    cut_at = float(ch["t"])
        except (OSError, ValueError):
            pass
        pos = i + 1
        rows.append({"kind": "quote", "t": cut_at, "dur": round(dur, 3), "mp4": str(dest.with_suffix(".mp4")),
                     "wav": str(dest.with_suffix(".wav")), "video": vid, "what": want.get("what", ""), "lines": lines})
        cuts.append((cut_at, dur + 0.3))
        dest.with_suffix(".sfx.json").write_text(json.dumps([[0.0, "static", -14.0]]), encoding="utf-8")
    if not rows:
        done.write_text(json.dumps({"sig": sig, "rows": []}), encoding="utf-8")
        return False
    if cfg["soundups"] > 0 and not broadcast:
        # the hook breathes: after a sentence of narration a clip plays with its own sound, then the next sentence
        try:
            got = soundups(mv, subject, job, srt, work, cfg["soundups"], who)
            ends = _sentence_ends(mv, srt, 4.0, 58.0)
            busy = [(a, a + d) for a, d in cuts]
            placed_at = []
            for dest, dur, vid, why in got:
                spot = next((e for e in ends if all(e + dur + 0.5 < a or e - 0.5 > b for a, b in busy)
                             and all(abs(e - q) > 9.0 for q in placed_at)), None)
                if spot is None:
                    continue
                placed_at.append(spot)
                busy.append((spot, spot + dur + 0.3))
                rows.append({"kind": "soundup", "t": round(spot, 3), "dur": round(dur, 3), "mp4": str(dest.with_suffix(".mp4")),
                             "wav": str(dest.with_suffix(".wav")), "video": vid, "what": why, "lines": [], "gain_db": -2.0})
                cuts.append((spot, dur + 0.3))
                dest.with_suffix(".sfx.json").write_text(json.dumps([[0.0, "whoosh", -10.0], [max(0.0, dur - 0.05), "hit_file", -6.0]]), encoding="utf-8")
                _log(mv, f"  soundbites: sound-up {_stamp(spot)} — {vid} {dur:.1f} s: {why[:70]}")
            if got and not placed_at:
                _log(mv, "  soundbites: sound-ups found but no sentence end free for them in the hook")
        except Exception as e:                             # noqa: BLE001 - an extra, never the video
            _log(mv, f"  soundbites: sound-ups skipped — {type(e).__name__}: {str(e)[:120]}")
    cinema.apply_pauses(job, mp3, srt, cuts)
    # the chapter pauses were cut into this same voice: their record follows the new file, or a second run
    # would cut them in again
    ca = job / "chapters_applied.json"
    if ca.exists():
        try:
            d = json.loads(ca.read_text(encoding="utf-8"))
            d["sig"] = f"{mp3.stat().st_size}:{int(mp3.stat().st_mtime)}"
            ca.write_text(json.dumps(d), encoding="utf-8")
        except (OSError, ValueError):
            pass
    # where each clip lands once the pauses before it have moved the voice
    for r in rows:
        r["t"] = round(float(r["t"]) + sum(p for c, p in cuts if c < float(r["t"]) - 1e-6), 3)
    rows.sort(key=lambda r: r["t"])
    (job / "soundbites.json").write_text(json.dumps(rows, indent=1, ensure_ascii=False), encoding="utf-8")
    done.write_text(json.dumps({"sig": f"{mp3.stat().st_size}:{int(mp3.stat().st_mtime)}", "rows": rows}), encoding="utf-8")
    _log(mv, f"soundbites: {len(rows)} clip(s) cut into the voice — " +
         ", ".join(f"{r['kind']} {_stamp(r['t'])} ({r['dur']:.1f} s)" for r in rows))
    return True


if __name__ == "__main__":
    import sys
    if sys.argv[1:2] == ["find"]:
        # python soundbites.py find "Spencer Haywood"  -> which videos have word-timed captions, and where they say the name
        class _MV:
            log = print
        work = Path(tempfile.mkdtemp(prefix="bites_"))
        name = " ".join(sys.argv[2:])
        vids = _candidates(_MV, name, [], work)
        for v in vids:
            hits = _name_hits(v["words"], [[_norm(w) for w in name.split()]])
            print(f"  {v['id']}  {v['title'][:60]!r}  {len(v['words'])} words, name said {len(hits)}x"
                  + (f" (first at {_stamp(hits[0][0])})" if hits else ""))
        shutil.rmtree(work, ignore_errors=True)
    else:
        print(__doc__)
