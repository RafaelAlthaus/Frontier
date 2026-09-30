#!/usr/bin/env python3
"""cinema.py — the cinematic documentary layer: chapters, year cards, tracked name labels, footage treatments.

A channel turns it on with a `look.cinema` block in its style file:

    "cinema": {
      "chapter_cards": true,        chapter titles from the script ("## Title" lines) become their own cards,
                                    with a short pause cut into the voice at the start of each chapter
      "title_card": true,           the first chapter card also carries the episode title
      "year_cards": true,           a year said by the narrator fades in, big, in the middle of the picture
      "labels": true,               a person's name label sits above their head and follows it (Apple Vision)
      "dust_on_archive": true,      old archive footage gets the dust overlay
      "framed_every": 5,            every n-th footage shot plays a little smaller on a dark grey ground
      "tv_every": 9,                every n-th archive shot plays inside an old television
      "strobe_guard": true,         single bright frames (camera flashes at 60 fps) are taken out of the clips
      "dark": false                 the darker grade of this look
    }

Chapters come from the script: a line holding only "## Title" before the first paragraph of a chapter.
They are taken out of the narration before the voice is recorded (chapters.json keeps them), a pause of
`chapters.pause_s` is cut into the voice at each chapter's first word — always between two paragraphs,
never inside a sentence — and the subtitles are timed again on the finished voice (faster-whisper).

Everything here is an extra: whatever goes wrong is logged, and the video is made without it.
"""

import json
import math
import re
import shutil
import subprocess
import sys
import tempfile
import wave
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
VTRACK = HERE / "tools" / "vtrack"
W, H, FPS = 1920, 1080, 30
HEAD = re.compile(r"^[ \t]*#{1,3}[ \t]*(.+?)[ \t]*#*[ \t]*$")
CLIP = re.compile(r"^[ \t]*\[\[\s*clip\s*:\s*(.+?)\s*\]\][ \t]*$", re.I)
# "[[mood: inspiring]]" on its own line: the music turns here, inside a chapter — where the story lifts or darkens
MOOD = re.compile(r"^[ \t]*\[\[\s*mood\s*:\s*([a-zA-Z]+)\s*\]\][ \t]*$", re.I)
WORDS = {"Czech": ("KAPITOLA", "Kapitola"), "Polish": ("ROZDZIAŁ", "Rozdział"), "English": ("CHAPTER", "Chapter"),
         "Slovak": ("KAPITOLA", "Kapitola"), "German": ("KAPITEL", "Kapitel")}


def settings(mv, style: str) -> dict:
    info = (getattr(mv, "STYLE_INFO", {}) or {}).get(style) or {}
    cfg = dict((info.get("look") or {}).get("cinema") or {})
    cfg["on"] = bool(cfg)
    cfg["pause_s"] = float((info.get("chapters") or {}).get("pause_s") or 1.6)
    cfg["language"] = str(info.get("language") or "English")
    return cfg


def _log(mv, msg: str) -> None:
    (mv.log if mv is not None else print)(msg)


def _norm(w: str) -> str:
    import unicodedata
    s = unicodedata.normalize("NFKD", str(w).lower())
    return re.sub(r"[^a-z0-9]", "", "".join(c for c in s if not unicodedata.combining(c)))


# ── chapters in the script ─────────────────────────────────────────────────────
def split_chapters(job: Path) -> str:
    """Take the "## Title" lines out of script.txt into chapters.json. Returns the clean script.
    Safe to call again: a script without heading lines is left as it is."""
    sc = job / "script.txt"
    try:
        text = sc.read_text(encoding="utf-8")
    except OSError:
        return ""
    if not any(HEAD.match(ln) or CLIP.match(ln) or MOOD.match(ln) for ln in text.splitlines()):
        return text
    chapters, paras, pending, clips, want = [], [], None, [], None
    moods, mood_pending = [], None
    body = []

    def flush():
        # a paragraph ends at a blank line OR at a marker line: "## Title", "[[clip: …]]" and "[[mood: …]]" written
        # without a blank line around them used to fold the next paragraph into the last one
        nonlocal body, pending, want, mood_pending
        if not body:
            return
        para = " ".join(body)
        body = []
        if pending:
            title, mood = pending, ""
            if "|" in title:
                title, mood = [x.strip() for x in title.split("|", 1)]
                mood = re.sub(r"[^a-z]", "", mood.lower())
            words_ = para.split()
            # a chapter that opens on a date and a score ("March first, 1971: seven to two.") is hard to hear: the words
            # after its first sentence are kept as a second lead to look for
            rest = re.split(r"(?<=[.!?])\s+", para, maxsplit=1)
            chapters.append({"n": len(chapters) + 1, "title": title, "lead": " ".join(words_[:14]), "mood": mood,
                             "lead_alt": " ".join((rest[1] if len(rest) > 1 else "").split()[:14])})
            pending = None
        if want is not None:
            want["lead"] = " ".join(para.split()[:14])     # the clip ends where these words begin
            want = None
        if mood_pending:
            moods.append({"mood": mood_pending, "lead": " ".join(para.split()[:14])})   # the music turns where these words begin
            mood_pending = None
        paras.append(para)

    for block in re.split(r"\n\s*\n", text.strip()):
        for ln in [x for x in block.strip().splitlines() if x.strip()]:
            m = HEAD.match(ln)
            if m:
                flush()
                pending = m.group(1).strip(" *_\"'„“”").rstrip(".:")
                continue
            mm = MOOD.match(ln)
            if mm:
                flush()
                mood_pending = re.sub(r"[^a-z]", "", mm.group(1).lower())
                continue
            c = CLIP.match(ln)
            if c:
                flush()
                # "[[clip: what he says]]": the real interview goes here, between this paragraph and the next
                want = {"n": len(clips) + 1, "what": c.group(1).strip(), "after": " ".join((paras[-1] if paras else "").split()[-12:])}
                clips.append(want)
                continue
            body.append(ln.strip())
        flush()
    clean = "\n\n".join(paras)
    (job / "script.chapters.txt").write_text(text, encoding="utf-8")
    sc.write_text(clean, encoding="utf-8")
    (job / "chapters.json").write_text(json.dumps(chapters, ensure_ascii=False, indent=1), encoding="utf-8")
    (job / "clips_wanted.json").write_text(json.dumps([c for c in clips if c.get("lead")], ensure_ascii=False, indent=1),
                                           encoding="utf-8")
    if moods:
        (job / "moods_wanted.json").write_text(json.dumps(moods, ensure_ascii=False, indent=1), encoding="utf-8")
    return clean


def place_moods(mv, job: Path, srt: Path) -> None:
    """moods_wanted.json (the script's "[[mood: …]]" lines) placed on the finished voice: moods.json [{t, mood}] —
    read by the music bed (sfx._bed_moods) together with the chapters' moods. Left alone when written by hand."""
    want = job / "moods_wanted.json"
    if not want.exists():
        return
    try:
        rows = json.loads(want.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return
    out = []
    for r in rows:
        t = _lead_in_captions(mv, job, srt, str(r.get("lead") or ""))
        if t is not None:
            out.append({"t": round(float(t), 2), "mood": str(r.get("mood") or "")})
    if out:
        (job / "moods.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
        _log(mv, "music: turns at " + ", ".join(f"{int(x['t']) // 60}:{int(x['t']) % 60:02d} {x['mood']}" for x in out))


# ── the voice: chapter pauses and subtitle timing ─────────────────────────────
def _parse_srt(text: str) -> list:
    out = []
    for block in text.strip().split("\n\n"):
        lines = block.strip().splitlines()
        if len(lines) >= 3 and "-->" in lines[1]:
            a, b = [x.strip() for x in lines[1].split("-->")]
            out.append([_ts(a), _ts(b), " ".join(lines[2:])])
    return out


def _ts(x: str) -> float:
    h, m, s = x.replace(",", ".").split(":")
    return int(h) * 3600 + int(m) * 60 + float(s)


def _srt_ts(t: float) -> str:
    t = max(0.0, float(t))
    ms = int(round(t * 1000))
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def _write_srt(path: Path, cues: list) -> None:
    path.write_text("\n".join(f"{k + 1}\n{_srt_ts(a)} --> {_srt_ts(b)}\n{t}\n" for k, (a, b, t) in enumerate(cues)),
                    encoding="utf-8")


def _find_lead(heard: list, lead: str, from_i: int) -> int:
    """Index in `heard` where the chapter's first words are spoken, or -1. The transcription hears names and long
    words a little differently ("obvěněny" for "obviněn"), so words count as the same when they are close, and the
    first words may be split or joined differently: the window is compared as one string too."""
    import difflib
    words = [w for w in (_norm(x) for x in lead.split()) if w]
    want = words[:8]
    if len(want) < 3:
        return -1
    # a year in the lead is read out as words ("1986" -> "tysiąc dziewięćset osiemdziesiątego szóstego") and heard
    # either way, so the lead's other words are also looked for in order with room for the number between them
    plain = [w for w in words if not w.isdigit()][:10] if not want[0].isdigit() else []
    toks = [_norm(w[0]) for w in heard]
    joined = "".join(want)
    near = lambda a, b: a == b or (len(a) > 3 and len(b) > 3 and difflib.SequenceMatcher(None, a, b).ratio() >= 0.78)
    head = "".join(want[:3])

    def glue(i):
        # as many heard words as it takes to spell the lead: "O. S. N." is three words for one
        out, j = "", i
        while j < len(toks) and len(out) < len(joined):
            out += toks[j]
            j += 1
        return out

    scores = {}
    best, best_i = 0.0, -1

    def in_order(i):
        if len(plain) < 4 or not (toks[i] == plain[0] or (len(plain[0]) > 3 and
                                                           difflib.SequenceMatcher(None, toks[i], plain[0]).ratio() >= 0.86)):
            return 0.0
        j, got, end = i, 0, min(len(toks), i + len(plain) + 8)
        for w in plain:
            k = j
            while k < end and not near(toks[k], w):
                k += 1
            if k < end:
                got, j = got + 1, k + 1
        return got / len(plain)

    def score(i):
        if i not in scores:
            hit = sum(1 for k, w in enumerate(want) if i + k < len(toks) and near(toks[i + k], w)) / len(want)
            scores[i] = max(hit, difflib.SequenceMatcher(None, glue(i), joined).ratio() - 0.1, in_order(i) - 0.05)
        return scores[i]

    for i in range(from_i, len(toks) - 2):
        # a cheap look first: the first three words, glued ("V Jodoku" heard as "Vidiodoku")
        if difflib.SequenceMatcher(None, "".join(toks[i:i + 3]), head).ratio() < 0.5 and not near(toks[i], want[0]):
            continue
        if score(i) > best:
            best, best_i = scores[i], i
            if best >= 0.97:
                break
    if best < 0.55:
        return -1
    # a chapter is a new paragraph: it starts after a full stop the transcription heard, so of the matches around
    # the best one a sentence start wins; then the better match, then the longer silence before it
    gap = lambda k: float(heard[k][1]) - float(heard[k - 1][2]) if k > 0 else 0.0
    ends = lambda k: k > 0 and bool(re.search(r"[.!?…][\"'”»)]*$", str(heard[k - 1][0]).strip()))
    around = [k for k in range(max(from_i, best_i - 3), min(len(toks) - 1, best_i + 4)) if k > 0 and
              (score(k) >= best - 0.12 or (ends(k) and score(k) >= best - 0.3))]
    return max(around, key=lambda k: (ends(k), round(score(k) / 0.05), gap(k), -abs(k - best_i))) if around else best_i


def _lead_in_captions(mv, job: Path, srt: Path, lead: str, from_t: float = 0.0):
    """The second (on the captions' clock) the chapter's first words are said, found in the captions — they hold the
    script's own words — or None. A chapter is a new paragraph, so only a sentence start can be one; the lead's words
    are looked for in order, numbers left out on both sides ("sto dwadzieścia" is "120" in the captions)."""
    import difflib
    words = [w for w in (_norm(x) for x in lead.split()) if w]
    plain = [w for w in words if not w.isdigit()][:10]
    if len(plain) < 4:
        return None
    try:
        cues = _parse_srt(srt.read_text(encoding="utf-8"))
    except OSError:
        return None
    clock = (mv._word_clock(job, srt) if mv is not None else {}) or {}
    stream = []                                    # (word, second, sentence starts here)
    ended = True
    for k, (a, b, text) in enumerate(cues):
        ws = text.split()
        wt = clock.get(k)
        for j, w in enumerate(ws):
            t = float(wt[j][0]) if wt and len(wt) == len(ws) else a + (b - a) * j / max(1, len(ws))
            if _norm(w):
                stream.append((_norm(w), t, ended))
            ended = bool(re.search(r"[.!?…][\"'”»)]*$", w))
    near = lambda x, y: x == y or (len(x) > 3 and len(y) > 3 and difflib.SequenceMatcher(None, x, y).ratio() >= 0.8)
    best, best_t = 0.0, None
    for i, (w, t, start) in enumerate(stream):
        if not start or t < from_t - 0.05:
            continue
        toks = [x for x, _, _ in stream[i:i + len(plain) + 6] if not x.isdigit()]
        j = got = early = 0
        for n, want in enumerate(plain):
            k = j
            while k < len(toks) and not near(toks[k], want):
                k += 1
            if k < len(toks):
                got, j = got + 1, k + 1
                early += 1 if n < 4 and k < 6 else 0
        score = got / len(plain)
        if early >= 2 and score > best:
            best, best_t = score, t
            if score >= 0.999:
                break
    return best_t if best >= 0.6 else None


def _heard_at(heard: list, t: float, from_i: int = 0) -> int:
    """The heard word a chapter found at second t starts with: a sentence start close by, else the nearest word."""
    near = [k for k in range(max(1, from_i), len(heard)) if abs(float(heard[k][1]) - t) <= 1.5]
    if not near:
        return -1
    ends = lambda k: bool(re.search(r"[.!?…][\"'”»)]*$", str(heard[k - 1][0]).strip()))
    starts = [k for k in near if ends(k) and abs(float(heard[k][1]) - t) <= 1.2]
    return min(starts or near, key=lambda k: abs(float(heard[k][1]) - t))


def _quiet_point(pcm, sr: int, lo: float, hi: float):
    """The middle of the longest quiet stretch of the voice between lo and hi seconds — the breath between two
    sentences, never the short stop inside a word — or None when nothing there is quiet."""
    a, b = max(0, int(lo * sr)), min(len(pcm), int(hi * sr))
    hop = max(1, int(sr * 0.01))
    n = (b - a) // hop
    if n < 4:
        return None
    x = pcm[a:a + n * hop].astype(np.float32).reshape(n, hop)
    rms = np.sqrt(np.mean(x ** 2, axis=1))
    quiet = rms < max(32768 * 10 ** (-45 / 20.0), float(rms.min()) * 2.0)
    best_len, best_at, run = 0, 0, 0
    for i, q in enumerate(quiet):
        run = run + 1 if q else 0
        if run > best_len:
            best_len, best_at = run, i - run + 1
    if best_len < 4:                                   # under 40 ms is inside a word
        return None
    return (a + (best_at + best_len / 2.0) * hop) / sr


def _cut_between(heard: list, i: int, pcm=None, sr: int = 44100) -> float:
    """Where a pause goes before heard[i]: in the silence between it and the word before."""
    prev_end, start = float(heard[i - 1][2]), float(heard[i][1])
    guess = (prev_end + start) / 2.0 if start - prev_end > 0.06 else max(prev_end, start - 0.03)
    if pcm is None:
        return guess
    prev_mid = (float(heard[i - 1][1]) + prev_end) / 2.0
    q = _quiet_point(pcm, sr, max(prev_mid, prev_end - 0.25), start + 0.25)
    return guess if q is None else q


def _audio_to_wav(src: Path, dst: Path) -> None:
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(src), "-ac", "1", "-ar", "44100", "-c:a", "pcm_s16le",
                    str(dst)], check=True)


def after_voice(mv, job: Path, mp3: Path, srt: Path, style: str) -> None:
    """Chapter pauses cut into the voice, then the subtitles timed on the finished voice."""
    cfg = settings(mv, style)
    if not cfg["on"]:
        return
    try:
        mv._word_clock(job, srt)                       # makes words_heard.json once
        _chapter_pauses(mv, job, mp3, srt, cfg)
        _retime_srt(mv, job, srt)
    except Exception as e:                             # noqa: BLE001 - an extra, never the video
        _log(mv, f"cinema: voice pass skipped — {type(e).__name__}: {str(e)[:160]}")
    if (HERE / "soundbites.py").exists():
        try:
            import soundbites
            if soundbites.after_voice(mv, job, mp3, srt, style):
                _retime_srt(mv, job, srt)
        except Exception as e:                         # noqa: BLE001
            _log(mv, f"soundbites: skipped — {type(e).__name__}: {str(e)[:160]}")
    try:
        place_moods(mv, job, srt)                     # after every pause is in: the turns sit on the final clock
    except Exception as e:                            # noqa: BLE001 - the chapters' moods still carry the bed
        _log(mv, f"music: turns not placed — {type(e).__name__}: {str(e)[:100]}")


def _chapter_pauses(mv, job: Path, mp3: Path, srt: Path, cfg: dict) -> None:
    cj, done = job / "chapters.json", job / "chapters_applied.json"
    heard_f = job / "words_heard.json"
    if not cj.exists() or not heard_f.exists():
        return
    chapters = json.loads(cj.read_text(encoding="utf-8"))
    sig = f"{mp3.stat().st_size}:{int(mp3.stat().st_mtime)}"
    if done.exists():
        try:
            if json.loads(done.read_text(encoding="utf-8")).get("sig") == sig:
                return
        except (ValueError, OSError):
            pass
    heard = [list(x) for x in json.loads(heard_f.read_text(encoding="utf-8"))]
    pause = max(0.6, float(cfg["pause_s"]))
    tmp = Path(tempfile.mkdtemp(prefix="cin_"))
    try:
        wav = tmp / "v.wav"
        _audio_to_wav(mp3, wav)
        with wave.open(str(wav), "rb") as r:
            sr, n = r.getframerate(), r.getnframes()
            pcm = np.frombuffer(r.readframes(n), "<i2")
        cuts, pos = [], 0
        for ch in chapters:
            at = _lead_in_captions(mv, job, srt, ch.get("lead", ""), float(heard[pos][1]) if pos < len(heard) else 1e9)
            i = _heard_at(heard, at, pos) if at is not None else -1
            if i <= 0:
                i = _find_lead(heard, ch.get("lead", ""), pos)
            if i <= 0 and ch.get("lead_alt"):
                # the chapter's second sentence found instead: the pause still goes before the paragraph's first word,
                # so the first sentence is walked back over
                at2 = _lead_in_captions(mv, job, srt, ch["lead_alt"], float(heard[pos][1]) if pos < len(heard) else 1e9)
                j = _heard_at(heard, at2, pos) if at2 is not None else -1
                if j > 0:
                    n_first = len(ch.get("lead", "").split()) - len(ch["lead_alt"].split()) + len(ch["lead_alt"].split())
                    first_n = len(re.split(r"(?<=[.!?])\s+", ch.get("lead", ""), maxsplit=1)[0].split())
                    i = max(pos + 1, j - first_n)
            if i <= 0:
                ch["t"] = None
                continue
            # the first chapter follows the cold open: it holds the episode title, so it gets a longer breath
            p = pause * (1.9 if ch.get("n") == 1 and cfg.get("title_card", True) else 1.0)
            if not cuts and i <= 3 and float(heard[min(i, len(heard) - 1)][1]) < 2.0:
                # the first chapter opens the narration itself: its breath goes BEFORE the first word — the lead was
                # found one word in, and "South [2.5 s of silence] Australia" split the video's opening words
                cuts.append((0.0, p, ch))
                pos = i + 1
                continue
            cut = _cut_between(heard, i, pcm, sr)
            cuts.append((cut, p, ch))
            pos = i + 1
        if not cuts:
            _log(mv, "cinema: no chapter start found in the voice — no pauses")
            return
        apply_pauses(job, mp3, srt, [(c, p) for c, p, _ in cuts], pcm, sr, tmp)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    acc = 0.0
    for cut, p, ch in cuts:
        ch["t"] = round(cut + acc, 3)
        ch["pause"] = round(p, 3)
        acc += p
    cj.write_text(json.dumps(chapters, ensure_ascii=False, indent=1), encoding="utf-8")
    done.write_text(json.dumps({"sig": f"{mp3.stat().st_size}:{int(mp3.stat().st_mtime)}",
                                "cuts": [[round(c, 3), p] for c, p, _ in cuts]}), encoding="utf-8")
    _log(mv, f"cinema: {len(cuts)} chapter pause(s) cut into the voice ({pause:.1f} s, between paragraphs)")


def apply_pauses(job: Path, mp3: Path, srt: Path, cuts: list, pcm=None, sr: int = 44100, tmp: Path = None) -> None:
    """Silence cut into the voice at `cuts` = [(second, length)], the subtitles and the heard words moved with it.
    The chapter cards and the interview clips (soundbites.py) both open the narration this way."""
    own = tmp is None
    tmp = tmp or Path(tempfile.mkdtemp(prefix="cin_"))
    try:
        if pcm is None:
            wav = tmp / "v.wav"
            _audio_to_wav(mp3, wav)
            with wave.open(str(wav), "rb") as r:
                sr, n = r.getframerate(), r.getnframes()
                pcm = np.frombuffer(r.readframes(n), "<i2")
        cuts = sorted((max(0.0, float(c)), max(0.0, float(p))) for c, p in cuts if float(p) > 0)
        pieces, last = [], 0
        for cut, p in cuts:
            k = min(len(pcm), int(round(cut * sr)))
            pieces.append(pcm[last:k])
            pieces.append(np.zeros(int(round(p * sr)), "<i2"))
            last = k
        pieces.append(pcm[last:])
        out = np.concatenate(pieces)
        with wave.open(str(tmp / "o.wav"), "wb") as w_:
            w_.setnchannels(1)
            w_.setsampwidth(2)
            w_.setframerate(sr)
            w_.writeframes(out.tobytes())
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(tmp / "o.wav"), "-c:a", "libmp3lame", "-b:a", "192k",
                        str(tmp / "o.mp3")], check=True)
        shutil.move(str(tmp / "o.mp3"), str(mp3))
    finally:
        if own:
            shutil.rmtree(tmp, ignore_errors=True)

    def shift(t: float) -> float:
        return t + sum(p for c, p in cuts if t >= c - 1e-6)

    heard_f = job / "words_heard.json"
    if heard_f.exists():
        heard = [list(x) for x in json.loads(heard_f.read_text(encoding="utf-8"))]
        for w_ in heard:
            w_[1], w_[2] = shift(float(w_[1])), shift(float(w_[2]))
        heard_f.write_text(json.dumps(heard), encoding="utf-8")
    cues = _parse_srt(srt.read_text(encoding="utf-8"))
    for c in cues:
        c[0], c[1] = shift(c[0]), shift(max(c[0], c[1]))
    _write_srt(srt, cues)
    (job / "words.json").unlink(missing_ok=True)
    # the chapters already placed move with the voice too
    cj = job / "chapters.json"
    if cj.exists():
        try:
            chapters = json.loads(cj.read_text(encoding="utf-8"))
            for ch in chapters:
                # a chapter that starts where a pause is cut comes after it: the clip plays, then the card
                if ch.get("t") is not None:
                    ch["t"] = round(shift(float(ch["t"])), 3)
            cj.write_text(json.dumps(chapters, ensure_ascii=False, indent=1), encoding="utf-8")
        except (OSError, ValueError):
            pass


def _retime_srt(mv, job: Path, srt: Path) -> None:
    """Every subtitle cue starts when its first word is said and ends just after its last — the voice's own clock."""
    clock = mv._word_clock(job, srt)
    if not clock:
        return
    cues = _parse_srt(srt.read_text(encoding="utf-8"))
    moved = 0
    for k, c in enumerate(cues):
        wt = clock.get(k)
        if not wt or len(wt) != len(c[2].split()):
            continue
        a, b = float(wt[0][0]) - 0.04, float(wt[-1][1]) + 0.22
        if abs(a - c[0]) > 0.08 or abs(b - c[1]) > 0.08:
            moved += 1
        c[0], c[1] = max(0.0, a), max(a + 0.3, b)
    for k in range(len(cues) - 1):
        if cues[k][1] > cues[k + 1][0] - 0.03:
            cues[k][1] = max(cues[k][0] + 0.25, cues[k + 1][0] - 0.03)
    _write_srt(srt, cues)
    (job / "words.json").unlink(missing_ok=True)
    mv._word_clock(job, srt)
    _log(mv, f"cinema: subtitles timed on the voice ({moved} of {len(cues)} cues moved)")


# ── chapter and title cards ────────────────────────────────────────────────────
def add_to_timeline(segs: list, srt: Path, job: Path, style: str, force: bool, workers: int = 2, engine=None) -> list:
    mv = engine
    cfg = settings(mv, style)
    if not cfg["on"]:
        return segs
    segs = _bites_on_timeline(mv, segs, job)
    if not cfg.get("chapter_cards", True):
        return segs
    cj = job / "chapters.json"
    if not cj.exists():
        return segs
    chapters = [c for c in json.loads(cj.read_text(encoding="utf-8")) if c.get("t") is not None]
    if not chapters:
        return segs
    import docgfx
    title = ""
    try:
        title = (job / "title.txt").read_text(encoding="utf-8").splitlines()[0].strip()
    except (OSError, IndexError):
        pass
    look = ((mv.STYLE_INFO.get(style) or {}).get("look") or {})
    # a look kit with its own chapter scene (STRATA) draws the card in its own type: silent (the music stop is the
    # sound), no light leak, and no card on the first chapter — the cold open is that chapter's opening
    kit = ""
    try:
        import kits as _kits
        kit = _kits.kit_of(look)
        kit = kit if "chapter" in (_kits.KITS.get(kit, {}).get("types") or {}) else ""
    except Exception:                                 # noqa: BLE001
        kit = ""
    word_up, word = WORDS.get(cfg["language"], WORDS["English"])
    out_dir = job / "motion"
    out_dir.mkdir(exist_ok=True)
    total = mv._audio_dur(job / "audio.mp3")
    tmp = Path(tempfile.mkdtemp(prefix="cinch_"))
    jobs, placed = [], []
    try:
        pics = docgfx._pictures(job, total)
        # the real photographs this video found of its people (photofx): a chapter card reads best on one of them
        photos = []
        for pj in sorted((job / "photofx").glob("m*/photos.json")) + sorted((job / "photofx").glob("m*/pick.json")):
            try:
                d = json.loads(pj.read_text(encoding="utf-8"))
                for pk in (d.get("picks") or ([d] if d.get("photo") else [])):
                    if Path(str(pk.get("photo") or "")).exists():
                        photos.append(Path(pk["photo"]))
            except (OSError, ValueError, AttributeError):
                pass
        for ch in chapters:
            t0 = float(ch["t"])
            if kit and int(ch.get("n") or 0) == 1:
                continue
            first = ch.get("n") == 1 and cfg.get("title_card", True)
            dur = round(float(ch.get("pause", cfg["pause_s"])) + (2.6 if first else 2.1), 2)
            ground = ""
            n_ch = int(ch.get("n") or 1)
            if photos and not kit:                    # a kit card sits on the chapter's own footage, not a portrait
                src = photos[(n_ch - 1) % len(photos)]
                try:
                    ground = docgfx.ground_uri(Path(src), 6, 0.62, tmp, sat=0.35)
                except Exception:                     # noqa: BLE001
                    ground = ""
            if not ground and pics:
                src = min(pics, key=lambda p: abs(p[0] - (t0 + 6.0)))[1]
                try:
                    ground = docgfx.ground_uri(Path(src), 10, 0.55 if not cfg.get("dark") else 0.48, tmp)
                except Exception:                     # noqa: BLE001
                    ground = ""
            sc = {"type": "chapter", "duration": dur, "n": str(ch.get("n") or ""), "kicker": f"{word_up} {ch.get('n')}",
                  "title": ch.get("title", ""), "episode": title if first else "", "ground": ground,
                  "dark": bool(cfg.get("dark"))}
            if kit:
                sc["kit"] = kit
            mp4 = out_dir / f"chapter_{int(ch.get('n') or 0):02d}.mp4"
            stamp = out_dir / f"chapter_{int(ch.get('n') or 0):02d}.json"
            key = json.dumps({k: sc[k] for k in ("duration", "kicker", "title", "episode", "dark")}, ensure_ascii=False)
            if force or not mp4.exists() or not stamp.exists() or stamp.read_text(encoding="utf-8") != key:
                mp4.unlink(missing_ok=True)
                stamp.write_text(key, encoding="utf-8")
                jobs.append((sc, mp4))
            placed.append((t0, mp4, dur))
        if jobs:
            _log(mv, f"cinema: rendering {len(jobs)} chapter card(s)...")
            if kit:
                _kits.render(kit, jobs, workers=1, look=look)
                for _sc, mp4 in jobs:
                    Path(mp4).with_suffix(".sfx.json").write_text("[]", encoding="utf-8")
            else:
                docgfx.render(jobs, workers=max(1, min(2, workers)), look=look)
                for _sc, mp4 in jobs:
                    _leak_in(Path(mp4))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    listing = chapter_list(job)
    if listing:
        (job / "chapters_youtube.txt").write_text(listing + "\n", encoding="utf-8")
    placed = [p for p in placed if Path(p[1]).exists()]
    # a chapter card owns its moment: any scene it would touch gives way — except an interview clip or the name
    # montage (soundbites.py), which the narration waits for: the card moves to the clip's end instead
    bites = [(float(s[0]), float(s[0]) + float(s[2])) for s in segs if "/soundbites/" in str(s[1]).replace("\\", "/")]
    moved = []
    for t0, mp4, dur in placed:
        for a, b in bites:
            if t0 < b + 0.2 and t0 + dur > a - 0.2:
                t0 = round(b + 0.05, 3)
        moved.append((t0, mp4, dur))
    placed = moved
    # a scene the card lands on (a map, a page, a strip) goes right behind the card or right in front of it — by
    # worth, so a map keeps its gap before a graphic does; a scene with no room either side is dropped by name
    kept = _make_room(mv, segs, [(a, a + d) for a, _, d in placed], "cinema")
    _log(mv, f"cinema: {len(placed)} chapter card(s) on the timeline")
    return sorted(kept + placed, key=lambda x: float(x[0]))



def _make_room(mv, segs: list, blocks: list, who: str) -> list:
    """The scenes settled around fixed `blocks` [(start, end)] — chapter cards, interview clips — that own their
    seconds. A scene a block lands on moves just behind it, or just in front of it, whichever is free; the scenes
    are settled by worth (a map or a page before a strip before a graphic), so when two want the same gap the one
    that matters more keeps it. A scene with no room either side is dropped — and said so, by name."""
    def worth(s):
        n = str(s[1]).replace("\\", "/")
        if "/soundbites/" in n:
            return 0
        if "/maps/" in n or "/headlines/" in n:
            return 1
        if "/photofx/" in n:
            return 2
        if "/motion/doc_" in n:
            return 4
        return 3
    taken = [(float(a), float(b)) for a, b in blocks]
    settled, moved, dropped = [], 0, []
    for s in sorted(segs, key=lambda x: (worth(x), float(x[0]))):
        s0, d0 = float(s[0]), float(s[2])
        free = lambda t: t >= 0.0 and not any(t < b + 0.3 and t + d0 > a - 0.3 for a, b in taken)
        if worth(s) == 0 or free(s0):
            settled.append(s)
            if worth(s):
                taken.append((s0, s0 + d0))
            continue
        hit = next(((a, b) for a, b in taken if s0 < b + 0.4 and s0 + d0 > a - 0.4), None)
        options = [round(hit[1] + 0.35, 3), round(hit[0] - d0 - 0.35, 3)] if hit else []   # clear of the 0.3 s margin
        t = next((o for o in options if free(o)), None)
        if t is None:
            dropped.append(f"{Path(str(s[1])).name} at {int(s0) // 60}:{int(s0) % 60:02d}")
            continue
        settled.append((t, s[1], s[2]))
        taken.append((t, t + d0))
        moved += 1
    if moved:
        _log(mv, f"{who}: {moved} scene(s) moved to make room")
    if dropped:
        _log(mv, f"{who}: no room either side for {', '.join(dropped)} — dropped")
    return sorted(settled, key=lambda x: float(x[0]))


def _bites_on_timeline(mv, segs: list, job: Path) -> list:
    """The interview clips and the name montage (soundbites.json) hold their exact seconds on the timeline: the
    narration is silent there, so nothing else may take the picture."""
    f = job / "soundbites.json"
    if not f.exists():
        return segs
    try:
        rows = [r for r in json.loads(f.read_text(encoding="utf-8")) if Path(str(r.get("mp4") or "")).exists()]
    except (OSError, ValueError):
        return segs
    if not rows:
        return segs
    placed = [(round(float(r["t"]), 3), str(r["mp4"]), round(float(r["dur"]), 3)) for r in rows]
    # a scene under a clip moves behind or in front of it (a map of the first place used to be dropped by the
    # name montage that opens the film); only a scene with no room either side goes, and it is named
    kept = _make_room(mv, segs, [(a, a + d) for a, _, d in placed], "soundbites")
    _log(mv, f"soundbites: {len(placed)} clip(s) on the timeline")
    return sorted(kept + placed, key=lambda x: float(x[0]))


def _leak_in(mp4: Path) -> None:
    """The film-burn light leak over a card's first second: one flash of assets/lightleak.mp4 (the file holds two),
    screen-blended so its black is invisible."""
    leak = HERE / "assets" / "lightleak.mp4"
    if not leak.exists() or not mp4.exists():
        return
    tmp = mp4.with_name(mp4.stem + "_lk.mp4")
    fc = ("[1:v]trim=0:0.95,setpts=PTS-STARTPTS,scale=1920:1080,fps=30,format=gbrp,"
          "colorchannelmixer=rr=.46:gg=.42:bb=.40,fade=t=in:st=0:d=0.12,fade=t=out:st=0.35:d=0.5,"
          "tpad=stop_mode=add:stop_duration=30:color=black[lk];"
          "[0:v]format=gbrp[b];[b][lk]blend=all_mode=screen:shortest=1,format=yuv420p[v]")
    try:
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(mp4), "-i", str(leak), "-filter_complex", fc,
                        "-map", "[v]"] + ENC + [str(tmp)], check=True, capture_output=True)
        if tmp.exists() and tmp.stat().st_size > 5000:
            shutil.move(str(tmp), str(mp4))
    except subprocess.CalledProcessError:
        tmp.unlink(missing_ok=True)


def mv_engine():
    """The engine module, for the tables it keeps (a channel's language). Imported here so cinema.py stays importable
    on its own."""
    import make_video
    return make_video


def chapter_list(job: Path) -> str:
    """"0:00 Úvod\\n1:32 Tábor, který neexistuje…" for the YouTube description."""
    try:
        chapters = [c for c in json.loads((job / "chapters.json").read_text(encoding="utf-8")) if c.get("t") is not None]
    except (OSError, ValueError):
        return ""
    if not chapters:
        return ""
    style = ""
    try:
        style = (job / "style.txt").read_text(encoding="utf-8").strip()
    except OSError:
        pass
    # the word for the opening chapter, in the channel's own language
    lang = str((getattr(mv_engine(), "STYLE_LANGUAGE", {}) or {}).get(style, "English"))
    intro = {"Czech": "Úvod", "Polish": "Wstęp", "German": "Intro", "Spanish": "Introducción",
             "French": "Introduction", "Portuguese": "Introdução", "Italian": "Introduzione"}.get(lang, "Intro")
    fmt = lambda t: f"{int(t // 3600)}:{int(t % 3600 // 60):02d}:{int(t % 60):02d}" if t >= 3600 else f"{int(t // 60)}:{int(t % 60):02d}"
    lines = [f"0:00 {intro}"] + [f"{fmt(float(c['t']))} {c['title']}" for c in chapters if float(c["t"]) >= 10]
    return "\n".join(lines)


# ── year cards and tracked name labels (drawn by libass with the captions) ─────
YEAR = re.compile(r"(?<![\d.,])(1[89]\d\d|20[0-3]\d)(?![\d])")
LABEL_REACH = 9.0          # seconds a name label may move to sit on a real shot of that person


def ass_extra(mv, job: Path, style: str, mute: list, overlays: list) -> tuple:
    """(style lines, event lines, indexes of overlays.json items drawn here instead)."""
    cfg = settings(mv, style)
    if not cfg["on"]:
        return [], [], set()
    styles, events, handled = [], [], set()
    try:
        s, e = _year_events(mv, job, cfg, mute)
        styles += s
        events += e
    except Exception as ex:                            # noqa: BLE001
        _log(mv, f"cinema: year cards skipped — {type(ex).__name__}: {str(ex)[:120]}")
    if cfg.get("labels", True) and VTRACK.exists() and sys.platform == "darwin":
        try:
            s, e, handled = _name_events(mv, job, cfg, mute, overlays, style)
            styles += s
            events += e
        except Exception as ex:                        # noqa: BLE001
            _log(mv, f"cinema: tracked labels skipped — {type(ex).__name__}: {str(ex)[:120]}")
    try:
        s, e = _quote_events(mv, job)
        styles += s
        events += e
    except Exception as ex:                            # noqa: BLE001
        _log(mv, f"cinema: interview quotes skipped — {type(ex).__name__}: {str(ex)[:120]}")
    return styles, events, handled


def _quote_events(mv, job: Path) -> tuple:
    """The words an interview clip says, quoted under the picture as it says them (soundbites.json "lines"): an old
    documentary's italic serif in quotation marks, centred low, each line on its own seconds."""
    f = job / "soundbites.json"
    if not f.exists():
        return [], []
    try:
        rows = json.loads(f.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return [], []
    styles = ["Style: CinQuote,EB Garamond,58,&H00F2ECE0,&H000000FF,&H00101010,&H8C000000,0,-1,0,0,100,100,0.5,0,1,1.2,2.4,2,0,0,0,1",
              "Style: CinQuoteShade,Roboto Condensed,10,&H00000000,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1"]
    events = []
    esc = lambda x: str(x).replace("\\", "").replace("{", "(").replace("}", ")")
    for r in rows:
        lines = r.get("lines") or []
        t0 = float(r.get("t") or 0)
        for k, ln in enumerate(lines):
            try:
                a, b, text = float(ln[0]), float(ln[1]), esc(ln[2]).strip()
            except (TypeError, ValueError, IndexError):
                continue
            if not text or b - a < 0.3:
                continue
            open_q = "\u201c" if k == 0 else ""
            close_q = "\u201d" if k == len(lines) - 1 else ""
            A, B = mv._ass_time(t0 + a), mv._ass_time(t0 + b + 0.25)
            events.append(f"Dialogue: 3,{A},{B},CinQuoteShade,,0,0,0,,{{\\an7\\pos(0,0)\\p1\\1a&H8C&\\blur60\\fad(200,260)}}"
                          f"m 260 900 l 1660 900 1660 1040 260 1040{{\\p0}}")
            events.append(f"Dialogue: 5,{A},{B},CinQuote,,0,0,0,,{{\\an2\\pos(960,986)\\fad(160,220)}}{open_q}{text}{close_q}")
    if events:
        _log(mv, f"cinema: {len(events) // 2} quoted line(s) under the interview clips")
    return styles, events


def _ass_colour(hex_: str, alpha: str = "00") -> str:
    h = hex_.lstrip("#")
    return f"&H{alpha}{h[4:6]}{h[2:4]}{h[0:2]}".upper()


def _year_events(mv, job: Path, cfg: dict, mute: list) -> tuple:
    if not cfg.get("year_cards", True):
        return [], []
    srt = job / "subs.srt"
    cues = _parse_srt(srt.read_text(encoding="utf-8"))
    clock = mv._word_clock(job, srt) or {}
    ink = "#EFE8D8" if not cfg.get("dark") else "#E6E1D6"
    vhs = bool(cfg.get("vhs"))
    face = "Inter Display Black" if vhs else "EB Garamond"
    styles = [f"Style: CinYear,{face},{250 if vhs else 236},{_ass_colour(ink)},&H000000FF,&H00101010,&H64000000,0,0,0,0,"
              f"100,100,{2 if vhs else 10},0,1,0,0,5,0,0,0,1",
              f"Style: CinYearR,{face},250,&H602828FF,&H000000FF,&H00101010,&H00000000,0,0,0,0,100,100,2,0,1,0,0,5,0,0,0,1",
              f"Style: CinYearC,{face},250,&H60FFDC28,&H000000FF,&H00101010,&H00000000,0,0,0,0,100,100,2,0,1,0,0,5,0,0,0,1",
              "Style: CinYearShade,Roboto Condensed,10,&H00000000,&H000000FF,&H00000000,&H00000000,0,0,0,0,"
              "100,100,0,0,1,0,0,7,0,0,0,1",
              "Style: CinYearRule,Roboto Condensed,10,&H0021 6DF2,&H000000FF,&H00000000,&H00000000,0,0,0,0,"
              "100,100,0,0,1,0,0,7,0,0,0,1".replace("&H0021 6DF2", "&H00216DF2")]
    events, last, seen = [], -99.0, {}
    # a photo scene carries the person's name: a year on top of it is one word too many
    photo_windows = []
    try:
        rows = json.loads((job / "plan.json").read_text(encoding="utf-8"))
        rows = rows if isinstance(rows, list) else rows.get("plan", [])
        t_ = 0.0
        for e in rows:
            if e[0] == "motion" and Path(str(e[1])).name.startswith(("strip_", "spot_", "tilt_", "objects_")):
                photo_windows.append((t_, t_ + float(e[3])))
            t_ += float(e[3])
    except (OSError, ValueError, TypeError):
        photo_windows = []
    for k, (a, b, text) in enumerate(cues):
        words = text.split()
        for wi, wtxt in enumerate(words):
            m = YEAR.search(wtxt)
            if not m:
                continue
            year = m.group(1)
            wt = clock.get(k)
            t = float(wt[wi][0]) if wt and len(wt) == len(words) else a
            t0, t1 = t - 0.15, t + 2.55
            if t0 - last < 26.0 or t - seen.get(year, -999) < 90:
                continue
            if any(t0 < e_ + 0.2 and t1 > s_ - 0.2 for s_, e_ in mute):
                continue
            if any(t0 < e_ and t1 > s_ for s_, e_ in photo_windows):
                continue
            last, seen[year] = t1, t
            A, B = mv._ass_time(max(0.0, t0)), mv._ass_time(t1)
            events.append(f"Dialogue: 6,{A},{B},CinYearShade,,0,0,0,,{{\\an7\\pos(0,0)\\p1\\1a&H70&\\blur90"
                          f"\\fad(420,460)}}m 560 330 b 760 250 1160 250 1360 330 b 1520 420 1520 660 1360 750 "
                          f"b 1160 830 760 830 560 750 b 400 660 400 420 560 330{{\\p0}}")
            if vhs:
                # the tape look: the year snaps in a hair too big and settles, its red and cyan copies pulled apart for
                # a third of a second, and a short orange rule wipes open under it
                events.append(f"Dialogue: 6,{A},{mv._ass_time(t0 + 0.42)},CinYearR,,0,0,0,,{{\\an5\\move(936,540,960,540,0,380)"
                              f"\\fscx112\\fscy112\\t(0,380,\\fscx100\\fscy100)\\blur1\\fad(0,120)}}{year}")
                events.append(f"Dialogue: 6,{A},{mv._ass_time(t0 + 0.42)},CinYearC,,0,0,0,,{{\\an5\\move(984,540,960,540,0,380)"
                              f"\\fscx112\\fscy112\\t(0,380,\\fscx100\\fscy100)\\blur1\\fad(0,120)}}{year}")
                events.append(f"Dialogue: 7,{A},{B},CinYear,,0,0,0,,{{\\an5\\pos(960,540)\\fad(60,460)\\fscx112\\fscy112"
                              f"\\t(0,380,\\fscx100\\fscy100)\\t(380,2700,\\fscx103\\fscy103)\\bord0\\shad0}}{year}")
                events.append(f"Dialogue: 7,{mv._ass_time(t0 + 0.3)},{B},CinYearRule,,0,0,0,,{{\\an7\\pos(880,700)\\p1\\fad(0,460)"
                              f"\\clip(880,700,880,706)\\t(0,420,\\clip(880,700,1040,706))}}m 0 0 l 160 0 160 6 0 6{{\\p0}}")
            else:
                events.append(f"Dialogue: 7,{A},{B},CinYear,,0,0,0,,{{\\an5\\pos(960,540)\\fad(420,460)\\blur0.6"
                              f"\\fscx96\\fscy96\\t(0,2700,\\fscx103\\fscy103)\\bord1.2\\3c&H101010&\\shad0}}{year}")
    if events:
        _log(mv, f"cinema: {len(events) // 2} year card(s)")
    return styles, events


def _type_w(text: str, file: str, size: int, spacing: float = 0.0, bold: bool = False) -> float:
    """How wide libass will set this line, in 1920x1080 units — so a rule can be exactly as long as the
    name above it. A rough guess when the font file or PIL is not there."""
    try:
        from PIL import ImageFont
        f = ImageFont.truetype(str(HERE / "assets" / "fonts" / file), size)
        asc, desc = f.getmetrics()
        # libass fits ascent+descent into the style's size, where PIL draws a full em: without this the
        # rule came out a fifth longer than the name it underlines
        w = f.getlength(text) * (1.035 if bold else 1.0) * (size / float(asc + desc) if asc + desc else 1.0)
    except Exception:                                   # noqa: BLE001
        w = len(text) * size * 0.46
    return w + spacing * max(0, len(text) - 1)


def _name_events(mv, job: Path, cfg: dict, mute: list, overlays: list, style: str = "") -> tuple:
    visual = job / "_visual.mp4"
    if not visual.exists():
        return [], [], set()
    # the same type as the name plate in the corner (_overlay_ass): the channel's sans, its serif for who the
    # person is, and a rule in the channel's own accent — only here it rides above the head
    look = ((getattr(mv, "STYLE_INFO", {}) or {}).get(style) or {}).get("look") or {}
    acc = str((look.get("accent") or ["#E3B25B"])[0])
    acc = acc if re.fullmatch(r"#[0-9a-fA-F]{6}", acc) else "#E3B25B"
    styles = ["Style: CinName,Roboto Condensed,64,&H00FFFFFF,&H000000FF,&H00101010,&H78000000,-1,0,0,0,"
              "100,100,2,0,1,0,2.2,2,0,0,0,1",
              "Style: CinRole,EB Garamond,42,&H00E6EDF2,&H000000FF,&H00101010,&H78000000,0,-1,0,0,"
              "100,100,0,0,1,0,1.6,8,0,0,0,1",
              f"Style: CinRule,Roboto Condensed,10,{_ass_colour(acc)},&H000000FF,&H00000000,&H00000000,0,0,0,0,"
              "100,100,0,0,1,0,0,8,0,0,0,1",
              "Style: CinShade,Roboto Condensed,10,&H00000000,&H000000FF,&H00000000,&H00000000,0,0,0,0,"
              "100,100,0,0,1,0,0,5,0,0,0,1"]
    events, handled = [], set()
    shown = _shots_under(job)
    slots = _real_slots(job)
    # a name is said while the picture is often a drawing or a map: the label may wait for (or reach back to) the
    # nearest real shot of that person within a few seconds — the moment itself is tried first
    cands = []
    for idx, it in enumerate(overlays):
        if not isinstance(it, dict) or str(it.get("style")) != "name":
            continue
        a0 = max(0.0, float(it.get("t") or 0) - 0.1)
        dur0 = max(2.4, min(4.2, float(it.get("dur") or 3.4)))
        opts = [(a0, dur0)]
        for s_, e_ in slots:
            if s_ < a0 + LABEL_REACH and e_ > a0 - LABEL_REACH:
                d = min(dur0, e_ - s_ - 0.35)
                if d >= 2.0:
                    opts.append((min(max(a0, s_ + 0.2), e_ - d - 0.15), d))
        seen_ = set()
        for a, dur in sorted(opts, key=lambda o: abs(o[0] - a0)):
            key = round(a, 1)
            if key in seen_ or any(a < e_ + 0.3 and a + dur > s_ - 0.3 for s_, e_ in mute):
                continue
            seen_.add(key)
            desc = shown(a, a + dur)
            if desc:
                cands.append((idx, a, dur, str(it.get("text") or ""), desc))
    ok = _same_person(mv, cands, keys=True)
    tmp = Path(tempfile.mkdtemp(prefix="cinlab_"))
    busy = []
    try:
        for k, (idx, a, dur, _name, _desc) in enumerate(cands):
            if k not in ok or idx in handled or any(a < e_ + 0.5 and a + dur > s_ - 0.5 for s_, e_ in busy):
                continue
            it = overlays[idx]
            try:
                track = _face_track(visual, a, dur, tmp / f"f{idx}_{k}")
            except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError, ValueError):
                track = []                              # this label keeps its usual place
            if not track:
                continue
            handled.add(idx)
            busy.append((a, a + dur))
            name = str(it.get("text") or "").replace("{", "(").replace("}", ")").strip()
            if name.isupper():                              # the reference look: a name in its own capitals
                name = " ".join(w if len(w) <= 2 and w.isalpha() and w in ("II", "III") else w.capitalize()
                                for w in name.split())
            role = str(it.get("sub") or "").replace("{", "(").replace("}", ")").strip()
            tw = _type_w(name, "Roboto-Condensed.ttf", 64, 2.0, bold=True)
            rolew = _type_w(role, "EB-Garamond-Italic.ttf", 42) if role else 0.0
            n = len(track)
            for fi, (x, y) in enumerate(track):
                t0, t1 = a + fi / FPS, a + (fi + 1) / FPS
                reveal = min(1.0, fi / (0.55 * FPS))
                ease = 1 - (1 - reveal) ** 3
                out = max(0.0, (fi - (n - 0.35 * FPS)) / (0.35 * FPS))
                alpha = f"{int(255 * min(1.0, out)):02X}"
                # the name opens from the middle out, the rule under it drawing itself the same way
                half = tw / 2 + 60.0
                clip = f"\\clip({x - half * ease:.0f},{y - 110:.0f},{x + half * ease:.0f},{y + 74:.0f})"
                A, B = mv._ass_time(t0), mv._ass_time(t1)
                # libass lays a drawing out from its own origin, so both shapes start at 0 and the
                # alignment centres them — written around zero they drifted half their width to the left
                sh_w, sh_h = max(2 * half, rolew + 120) + 110, (150 if role else 108)
                events.append(f"Dialogue: 7,{A},{B},CinShade,,0,0,0,,{{\\an5\\pos({x:.1f},{y - 22:.1f})\\p1"
                              f"\\1a&H{int(0xB4 + (255 - 0xB4) * max(1.0 - ease, min(1.0, out))):02X}&\\blur84}}"
                              f"m 0 0 l {sh_w:.0f} 0 {sh_w:.0f} {sh_h:.0f} 0 {sh_h:.0f}{{\\p0}}")
                events.append(f"Dialogue: 8,{A},{B},CinName,,0,0,0,,{{\\an2\\pos({x:.1f},{y:.1f}){clip}\\alpha&H{alpha}&}}{name}")
                rw = tw / 2 * ease
                if rw > 2:
                    events.append(f"Dialogue: 8,{A},{B},CinRule,,0,0,0,,{{\\an8\\pos({x:.1f},{y + 10:.1f})"
                                  f"\\alpha&H{alpha}&\\p1}}m 0 0 l {2 * rw:.1f} 0 {2 * rw:.1f} 3 0 3{{\\p0}}")
                if role and fi > 0.25 * FPS:
                    ra = max(int(255 * (1 - min(1.0, (fi - 0.25 * FPS) / (0.4 * FPS)))), int(255 * min(1.0, out)))
                    events.append(f"Dialogue: 8,{A},{B},CinRole,,0,0,0,,{{\\an8\\pos({x:.1f},{y + 26:.1f})\\alpha&H{ra:02X}&}}{role}")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    if handled:
        _log(mv, f"cinema: {len(handled)} name label(s) follow the person on screen")
    return styles, events, handled



def _shots_under(job: Path):
    """f(a, b) -> what the real footage on screen from a to b shows (the shot logs' words), or "" when it is not
    one real shot the whole time."""
    try:
        plan = json.loads((job / "plan.json").read_text(encoding="utf-8"))
        rows = plan if isinstance(plan, list) else plan.get("plan", [])
        clips = {Path(r["path"]).name: r for r in json.loads((job / "youtube" / "clips.json").read_text(encoding="utf-8"))}
    except (OSError, ValueError, KeyError, TypeError):
        return lambda a, b: ""
    spans, t = [], 0.0
    for e in rows:
        spans.append((t, t + float(e[3]), e))
        t += float(e[3])
    logs = {}

    def desc(r):
        vid = r.get("video")
        if vid not in logs:
            try:
                import youtube as _yt
                logs[vid] = json.loads((job / "youtube" / "catalog" / f"{_yt._safe(vid)}.json")
                                       .read_text(encoding="utf-8")).get("shots") or []
            except (OSError, ValueError):
                logs[vid] = []
        s, e = float(r.get("start") or 0), float(r.get("end") or 0)
        words = [str(sh.get("shows") or "") for sh in logs[vid] if min(_sec(sh.get("end")), e) - max(_sec(sh.get("start")), s) > 0.3]
        return "; ".join(words)[:300]

    def f(a, b):
        under = [x for x in spans if x[0] < b and x[1] > a]
        if len(under) != 1 or under[0][2][0] != "video":
            return ""
        r = clips.get(Path(str(under[0][2][1])).name)
        return desc(r) if r else ""
    return f


def _real_slots(job: Path) -> list:
    """[(start, end)] of every real footage shot on the timeline (plan.json)."""
    try:
        plan = json.loads((job / "plan.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    rows = plan if isinstance(plan, list) else plan.get("plan", [])
    out, t = [], 0.0
    for e in rows:
        if e[0] == "video":
            out.append((t, t + float(e[3])))
        t += float(e[3])
    return out


def _same_person(mv, cands: list, keys: bool = False) -> set:
    """The label indexes (or, with keys, the positions in `cands`) whose footage really shows the named person —
    asked once, all together. A name on the wrong face is worse than a name in the corner."""
    if not cands:
        return set()
    lines = "\n".join(f"{k}. NAME: {name} | FOOTAGE SHOWS: {desc}" for k, (_i, _a, _d, name, desc) in enumerate(cands))
    ask = ("Each numbered line pairs a person's name (written in Czech or Polish transliteration) with a description of the "
           "real footage on screen at that moment. Answer which lines' footage very likely shows THAT person as the main "
           "face — the description names them (in any spelling: Kim Jong Un = Kim Dzong Un = Kim Čong-un) or unmistakably "
           "describes them. If the footage shows someone else, several people without naming this one, a place, a document "
           "or a photo of someone else, the answer is no.\n\n" + lines +
           "\n\nReturn ONLY a JSON list of the numbers whose answer is yes, e.g. [0, 3].")
    try:
        got = mv._json_items(ask, max_tokens=400)
    except (Exception, SystemExit):                   # noqa: BLE001
        return set()
    keep = set()
    for x in got or []:
        try:
            k = int(x)
        except (TypeError, ValueError):
            continue
        if 0 <= k < len(cands):
            keep.add(k if keys else cands[k][0])
    return keep

def _face_track(visual: Path, a: float, dur: float, base: Path) -> list:
    """[(x, y)] per frame (1920x1080 space): where a label above the main face goes, or [] when no steady face."""
    clip = base.with_suffix(".mp4")
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-ss", f"{a:.3f}", "-t", f"{dur:.3f}", "-i", str(visual),
                    "-an", "-vf", "scale=960:540,fps=30", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23",
                    str(clip)], check=True)
    out = base.with_suffix(".json")
    subprocess.run([str(VTRACK), "faces", str(clip), str(out), "1"], check=True, capture_output=True, timeout=120)
    frames = json.loads(out.read_text(encoding="utf-8")).get("frames") or []
    n = max(1, int(round(dur * FPS)))
    if len(frames) < n * 0.6:
        return []
    pts, prev = [], None
    for f in frames[:n]:
        boxes = [b for b in f.get("boxes") or [] if b[2] * b[3] > 0.004 and b[4] > 0.5]
        if not boxes:
            pts.append(None)
            continue
        if prev is None:
            pick = max(boxes, key=lambda b: b[2] * b[3] * (1.3 - abs(b[0] + b[2] / 2 - 0.5)))
        else:
            pick = min(boxes, key=lambda b: abs(b[0] + b[2] / 2 - prev[0]) + abs(b[1] - prev[1]))
            # the camera cut: another person, a jump up or down the frame, or a much bigger head
            if (abs(pick[0] + pick[2] / 2 - prev[0]) > 0.18 or abs(pick[1] - prev[1]) > 0.13
                    or not prev[2] / 1.7 < pick[3] < prev[2] * 1.7):
                pts.append(None)
                continue
        prev = (pick[0] + pick[2] / 2, pick[1], pick[3])
        pts.append(prev)
    found = [p for p in pts if p]
    if len(found) < n * 0.7:
        return []
    # A gap used to hold the last point and then snap to the next one, which is exactly what a viewer
    # reads as a stutter. The gap is crossed in a straight line instead, and the whole path is then
    # filtered twice — two box passes make a triangular window, which glides where one pass still steps.
    for i in range(len(pts)):
        if pts[i] is None:
            nxt = next((k for k in range(i + 1, len(pts)) if pts[k]), None)
            prv = next((k for k in range(i - 1, -1, -1) if pts[k]), None)
            if prv is None:
                pts[i] = pts[nxt]
            elif nxt is None:
                pts[i] = pts[prv]
            else:
                w = (i - prv) / float(nxt - prv)
                pts[i] = tuple(pts[prv][c] + (pts[nxt][c] - pts[prv][c]) * w for c in range(3))
    while len(pts) < n:
        pts.append(pts[-1])
    arr = np.array([[p[0], p[1], p[2]] for p in pts[:n]], dtype=float)

    def _smooth(col, win):
        win = max(3, min(win | 1, max(3, len(col) | 1)))
        k, pad = np.ones(win) / win, win // 2
        return np.convolve(np.pad(col, pad, mode="edge"), k, mode="valid")

    sm = np.stack([_smooth(_smooth(arr[:, c], 13), 9) for c in range(3)], 1)
    # Above the head, or under the chin when the head sits too high: decided once, on the median of the
    # whole shot. Frame by frame it flipped between the two and threw the label half the screen.
    under = float(np.median(sm[:, 1] * H - 0.16 * sm[:, 2] * H)) < 130
    track, last = [], None
    for cx, top, fh in sm:
        x = min(max(cx * W, 420), W - 420)
        y = min(H - 140, (top + fh) * H + 96) if under else max(96.0, top * H - 0.16 * fh * H)
        # under half a pixel is the detector breathing, not the head moving: hold the last place so the
        # type stays still instead of shimmering
        if last is not None and abs(x - last[0]) < 0.5 and abs(y - last[1]) < 0.5:
            x, y = last
        last = (x, y)
        track.append((x, y))
    return track


# ── footage treatments, after the segments are rendered ────────────────────────
def post_segments(mv, plan: list, segs: list, job: Path, style: str) -> list:
    cfg = settings(mv, style)
    if not cfg["on"]:
        return segs
    try:
        return _treat(mv, plan, segs, job, style, cfg)
    except Exception as e:                             # noqa: BLE001
        _log(mv, f"cinema: footage treatments skipped — {type(e).__name__}: {str(e)[:160]}")
        return segs


def _kinds(job: Path) -> dict:
    """clip file name -> the shot log's kind for it (archive, news, modern…)."""
    ydir = job / "youtube"
    try:
        rows = json.loads((ydir / "clips.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    logs, out = {}, {}
    for r in rows:
        vid = r.get("video")
        if vid not in logs:
            try:
                import youtube as _yt
                logs[vid] = json.loads((ydir / "catalog" / f"{_yt._safe(vid)}.json")
                                       .read_text(encoding="utf-8")).get("shots") or []
            except (OSError, ValueError):
                logs[vid] = []
        s, e = float(r.get("start") or 0), float(r.get("end") or 0)
        best, over = "", 0.0
        for sh in logs[vid]:
            a, b = _sec(sh.get("start")), _sec(sh.get("end"))
            ov = min(b, e) - max(a, s)
            if ov > over:
                best, over = str(sh.get("kind") or ""), ov
        out[Path(r["path"]).name] = best
    return out


def _sec(v) -> float:
    if isinstance(v, (int, float)):
        return float(v)
    p = str(v or "0").split(":")
    try:
        return sum(float(x) * 60 ** i for i, x in enumerate(reversed(p)))
    except ValueError:
        return 0.0


def _treat(mv, plan: list, segs: list, job: Path, style: str, cfg: dict) -> list:
    kinds = _kinds(job)
    # a look kit's footage treatment (frames.py): how a shot sits in the frame — on a chart, a white page, a stage...
    frame_kind = str(cfg.get("frame") or "").lower().strip()
    if not kinds and not frame_kind:
        return segs
    dust = HERE / "assets" / "overlay_dust.mp4"
    tv = _tv_asset(mv, job, cfg)
    framed_every = int(cfg.get("framed_every") or 0)
    tv_every = int(cfg.get("tv_every") or 0)
    n_foot = n_arch = 0
    counts = {"dust": 0, "framed": 0, "tv": 0}
    out = list(segs)
    t = 0.0
    frame_mutes: list = []
    # look.cinema.frame_clear_of_labels: a shot that carries one of the director's text labels (overlays.json) is
    # left full frame — the label and the frame's own plate ("ARCHIVE", a timecode) would sit on top of each other.
    # The frame it would have had goes to the next shot without a label, so the channel keeps its mix.
    label_spans, owed = [], False
    if cfg.get("frame_clear_of_labels"):
        try:
            for it in json.loads((job / "overlays.json").read_text(encoding="utf-8")):
                a = float(it.get("t") or 0) - 0.1
                label_spans.append((a, a + max(2.2, min(4.5, float(it.get("dur") or 3.6)))))
        except (OSError, ValueError, TypeError, AttributeError):
            label_spans = []
    for i, (e, seg) in enumerate(zip(plan, segs)):
        dur = float(e[3])
        start, t = t, t + dur
        if e[0] != "video" or seg is None:
            continue
        name = Path(str(e[1])).name
        kind = kinds.get(name)
        if kind is None:
            if not frame_kind:
                continue
            kind = ""                       # stock or AI footage: no shot log, still framed by the kit
        n_foot += 1
        archive = kind in ("archive", "still")
        dst = Path(seg).with_name(Path(seg).stem + "_cin.mp4")
        mode = ""
        if archive:
            n_arch += 1
            if tv is not None and tv_every and dur >= 2.6 and (n_arch == 2 or (n_arch % tv_every == 0)):
                mode = "tv"
            elif cfg.get("dust_on_archive", True) and dust.exists():
                mode = "dust"
        pop_every = int(cfg.get("pop_every") or 11)
        if (not mode and pop_every and counts.get("pop", 0) < int(cfg.get("pop_max") or 3) and dur >= 3.4
                and n_foot % pop_every == 0 and start > 30 and _has_face(Path(seg))):
            mode = "pop"
        if not mode and framed_every and dur >= 3.0 and n_foot % framed_every == 0 and start > 20:
            mode = "framed"
        if (not mode and frame_kind and dur >= 2.0
                and (owed or cfg.get("frame_all") or n_foot % max(1, int(cfg.get("frame_every") or 2)) == 0)):
            if any(a < start + dur + 0.3 and b > start - 0.3 for a, b in label_spans):
                owed = True                 # a label is on this shot: it stays full frame, the next shot is framed
            else:
                mode, owed = "frame", False
        if not mode:
            continue
        try:
            if mode == "dust":
                _dust(Path(seg), dust, dst, dur)
            elif mode == "framed":
                _framed(Path(seg), dst, dur, cfg)
            elif mode == "frame":
                import frames
                if not frames.treat(mv, frame_kind, Path(seg), dst, dur, cfg, job, start, n_foot):
                    continue
            elif mode == "pop":
                if not _pop(mv, Path(seg), dst, dur, job, i, style):
                    continue
            else:
                _in_tv(Path(seg), tv, dst, dur, variant=counts.get("tv", 0))
            if dst.exists() and dst.stat().st_size > 2000:
                out[i] = dst
                counts[mode] = counts.get(mode, 0) + 1
                if mode == "frame":
                    frame_mutes.append((round(start, 2), round(start + dur, 2)))
        except subprocess.CalledProcessError as ex:
            _log(mv, f"  cinema: slot {i} keeps its plain footage — {str(ex)[:80]}")
    (job / "frame_mutes.json").write_text(json.dumps(frame_mutes), encoding="utf-8")
    _log(mv, f"cinema: footage treated — {counts['dust']} archive shot(s) with dust, {counts['framed']} framed, "
             f"{counts['tv']} in the old TV, {counts.get('pop', 0)} with the person lifted off a still"
             + (f", {counts.get('frame', 0)} in the {frame_kind} frame" if frame_kind else ""))
    return out


def _has_face(seg: Path) -> bool:
    """A clear, large face in most of the shot (Apple Vision) — the shots worth lifting a person off."""
    if not VTRACK.exists() or sys.platform != "darwin":
        return False
    out = seg.with_name(seg.stem + "_faces.json")
    try:
        subprocess.run([str(VTRACK), "faces", str(seg), str(out), "6"], check=True, capture_output=True, timeout=60)
        frames = json.loads(out.read_text(encoding="utf-8")).get("frames") or []
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError, ValueError):
        return False
    finally:
        out.unlink(missing_ok=True)
    big = sum(1 for f in frames if any(b[2] * b[3] > 0.012 and b[4] > 0.6 for b in f.get("boxes") or []))
    return bool(frames) and big >= 0.7 * len(frames)


def _pop(mv, seg: Path, dst: Path, dur: float, job: Path, idx: int, style: str) -> bool:
    """A real shot turned into its "real object" moment: the frame held, the person cut out and lifted off it while
    the rest softens and pulls back (PHOTO FX's depth pop on a frame of the footage)."""
    try:
        import photofx
    except ImportError:
        return False
    still = job / "photofx" / "footage_frames" / f"{seg.stem}.jpg"
    still.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-ss", f"{dur * 0.35:.2f}", "-i", str(seg), "-frames:v", "1",
                    "-q:v", "2", str(still)], check=True, capture_output=True)
    try:
        ok = photofx.depth_segment(mv, still, dur, dst, job, idx=idx, style=style)
    except Exception as e:                            # noqa: BLE001
        _log(mv, f"  cinema: slot {idx} keeps its footage — {str(e)[:80]}")
        return False
    return bool(ok) and dst.exists()


ENC = ["-c:v", "libx264", "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p", "-r", str(FPS),
       "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-an"]


def _dust(seg: Path, dust: Path, dst: Path, dur: float) -> None:
    fc = (f"[1:v]scale={W}:{H},format=gbrp,colorchannelmixer=rr=.55:gg=.55:bb=.55[d];"
          f"[0:v]format=gbrp[b];[b][d]blend=all_mode=screen:shortest=1,"
          f"eq=saturation=0.86:contrast=1.04,format=yuv420p[v]")
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(seg), "-stream_loop", "-1", "-i", str(dust),
                    "-filter_complex", fc, "-map", "[v]", "-t", f"{dur:.3f}"] + ENC + [str(dst)],
                   check=True, capture_output=True)


def _framed(seg: Path, dst: Path, dur: float, cfg: dict) -> None:
    s = float(cfg.get("framed_scale") or 0.85)
    bg = str(cfg.get("framed_bg") or "#2A2B2D").lstrip("#")
    fw, fh = int(W * s) // 2 * 2, int(H * s) // 2 * 2
    x, y = (W - fw) // 2, (H - fh) // 2
    # the picture rests on a dark grey ground with a soft shadow, and drifts in by a hair
    fc = (f"color=c=0x{bg}:s={W}x{H}:r={FPS}:d={dur:.3f},format=yuv420p,noise=alls=7:allf=t[g];"
          f"color=c=black:s={fw + 60}x{fh + 60}:r={FPS}:d={dur:.3f},format=yuva420p,"
          f"geq=lum='16':cb='128':cr='128':a='255*0.55*clip(min(min(X,W-X),min(Y,H-Y))/30,0,1)',gblur=sigma=18[sh];"
          f"[0:v]scale={fw}:{fh}:flags=lanczos,setsar=1[p];"
          f"[g][sh]overlay={x - 30}:{y - 10}[g2];[g2][p]overlay={x}:{y},"
          f"scale=w='{W}*(1+0.018*t/{dur:.3f})':h=-2:eval=frame:flags=bicubic,crop={W}:{H},format=yuv420p[v]")
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(seg), "-filter_complex", fc, "-map", "[v]",
                    "-t", f"{dur:.3f}"] + ENC + [str(dst)], check=True, capture_output=True)


def _tv_asset(mv, job: Path, cfg: dict):
    """The old television: one picture per channel look, drawn once with a pure green screen, and the screen's mask."""
    name = str(cfg.get("tv") or ("tv_dark" if cfg.get("dark") else "tv"))
    if name not in ("tv", "tv_dark"):
        name = "tv_" + re.sub(r"[^a-z0-9]", "", name.lower().replace("tv_", ""))
    base = HERE / "assets" / "cinema"
    img, mask = base / f"{name}.jpg", base / f"{name}_mask.png"
    if img.exists() and mask.exists():
        return (img, mask)
    base.mkdir(parents=True, exist_ok=True)
    prompts = {
        "tv_retro": ("Photograph of a 1970s American wood-cabinet console television set standing on a shag carpet in a living "
                     "room of the era: walnut veneer cabinet, a wide rounded CRT screen with a dark bezel, chrome channel dial "
                     "and volume knob on the right, a fabric speaker grille under the screen, a small trophy and a framed photo "
                     "on top of the set. The screen shows a flat, perfectly uniform pure chroma green (#00FF00), edge to edge "
                     "inside the screen bezel, no reflections on it. The set fills the middle of a wide 16:9 frame, straight on, "
                     "eye level. Warm lamp light from one side, wood-panelled wall behind, deep shadows, film grain, "
                     "documentary still."),
    }
    prompt = prompts.get(name) or (
              "Photograph of a 1960s Soviet valve television set standing on a dark wooden sideboard, the cabinet looks almost "
              "like an old radio: polished walnut veneer, a fabric speaker grille, two bakelite knobs, and a small rounded "
              "CRT screen in the upper half. The screen shows a flat, perfectly uniform pure chroma green (#00FF00), edge to "
              "edge inside the screen bezel, no reflections on it. The set fills the middle of a wide 16:9 frame, straight "
              "on, eye level. Dim room behind, dark peeling wallpaper, soft warm light from one side, deep shadows, film "
              "grain, documentary still." + (" Colder, darker light, grey-green tint, dust." if cfg.get("dark") else ""))
    try:
        mv.image_gen(prompt, img, "old TV set", kie_create_fn=getattr(mv, "_kie_create", None))
    except (Exception, SystemExit) as e:              # noqa: BLE001
        _log(mv, f"cinema: no TV picture this time — {str(e)[:100]}")
        return None
    from PIL import Image
    im = Image.open(img).convert("RGB").resize((W, H), Image.LANCZOS)
    im.save(img, quality=95)
    a = np.asarray(im).astype(np.int16)
    g = (a[:, :, 1] > 90) & (a[:, :, 1] > a[:, :, 0] + 35) & (a[:, :, 1] > a[:, :, 2] + 35)
    if g.sum() < 20000:
        _log(mv, "cinema: the TV picture has no clear green screen — TV shots are off")
        img.unlink(missing_ok=True)
        return None
    _save_mask(g, mask, base / f"{name}_box.json", a)
    return (img, mask)


def _save_mask(g, mask: Path, box_f: Path, a=None) -> None:
    """The screen mask: the strong green's own box (a greenish wallpaper never counts), grown past the green's soft
    edge so no green fringe is left around the picture."""
    from PIL import Image, ImageFilter
    core = g
    if a is not None:
        core = (a[:, :, 1] > 170) & (a[:, :, 1] > a[:, :, 0] + 90) & (a[:, :, 1] > a[:, :, 2] + 90)
    ys, xs = np.where(core if core.sum() > 20000 else g)
    # the screen is the dense middle of the strong green: its 1st-99th percentile box
    x0, x1 = int(np.percentile(xs, 0.5)), int(np.percentile(xs, 99.5))
    y0, y1 = int(np.percentile(ys, 0.5)), int(np.percentile(ys, 99.5))
    keep = np.zeros_like(g)
    keep[max(0, y0 - 16):y1 + 17, max(0, x0 - 16):x1 + 17] = True
    if a is not None:        # inside the screen's box any green-leaning pixel is screen, the dark rim included
        g = g | ((a[:, :, 1] > a[:, :, 0] + 12) & (a[:, :, 1] > a[:, :, 2] + 12))
    m = Image.fromarray(((g & keep) * 255).astype(np.uint8)).convert("L").filter(ImageFilter.MaxFilter(17))
    arr = np.asarray(m) > 127
    ys, xs = np.where(arr)
    box = [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]
    m.save(mask)
    box_f.write_text(json.dumps(box), encoding="utf-8")


def _in_tv(seg: Path, tv, dst: Path, dur: float, variant: int = 0) -> None:
    img, mask = tv
    box = json.loads((mask.parent / (mask.stem.replace("_mask", "") + "_box.json")).read_text(encoding="utf-8"))
    x0, y0, x1, y1 = box
    sw, sh = (x1 - x0 + 1) // 2 * 2, (y1 - y0 + 1) // 2 * 2
    # four ways of looking at the set, so no two TV shots move alike: a slow push, a pull back, a drift across it
    # that ends close on the screen, and a close-up on the screen easing in
    d = f"{dur:.3f}"
    moves = [f"scale=w='{W}*(1.10-0.10*t/{d})':h=-2:eval=frame:flags=bicubic,crop={W}:{H}",
             f"scale=w='{W}*(1.00+0.12*t/{d})':h=-2:eval=frame:flags=bicubic,crop={W}:{H}:(iw-{W})/2:(ih-{H})/2",
             f"scale=w='{W}*(1.06+0.16*t/{d})':h=-2:eval=frame:flags=bicubic,crop={W}:{H}:'(iw-{W})*(0.35+0.4*t/{d})':'(ih-{H})*0.45'",
             f"scale=w='{W}*(1.30-0.06*t/{d})':h=-2:eval=frame:flags=bicubic,crop={W}:{H}:(iw-{W})/2:'(ih-{H})*0.42'"]
    move = moves[int(variant) % len(moves)]
    # the footage inside the screen: soft, scan-lined, a touch of glow and flicker-free noise; the set around it;
    # the camera eases in on the whole set
    fc = (f"[0:v]scale={sw}:{sh}:force_original_aspect_ratio=increase:flags=bicubic,crop={sw}:{sh},"
          f"eq=saturation=0.55:contrast=1.12:brightness=0.02,gblur=sigma=0.9,"
          f"noise=alls=10:allf=t,"
          f"geq=lum='lum(X,Y)*(0.86+0.14*mod(Y,4)/3)':cb='cb(X,Y)':cr='cr(X,Y)',"
          f"vignette=angle=0.9,format=yuv420p[scr];"
          f"color=c=black:s={W}x{H}:r={FPS}:d={dur:.3f},format=yuv420p[bk];"
          f"[bk][scr]overlay={x0}:{y0}[under];"
          f"[1:v]loop=loop=-1:size=1:start=0,scale={W}:{H},despill=type=green:mix=0.8:expand=0.4,format=rgba[set];"
          f"[2:v]loop=loop=-1:size=1:start=0,scale={W}:{H},format=gray,negate,gblur=sigma=1.2[alpha];"
          f"[set][alpha]alphamerge[setA];"
          f"[under][setA]overlay=0:0:shortest=1,"
          f"{move},"
          f"format=yuv420p[v]")
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(seg), "-i", str(img), "-i", str(mask),
                    "-filter_complex", fc, "-map", "[v]", "-t", f"{dur:.3f}"] + ENC + [str(dst)],
                   check=True, capture_output=True)


# ── clips: camera flashes out ──────────────────────────────────────────────────
def unflash(clip: Path) -> int:
    """Take single bright frames (press-camera strobes that 60 fps footage keeps for one or two frames) out of a
    clip: each is replaced by the frame before it. Returns how many were replaced."""
    p = subprocess.run(["ffmpeg", "-v", "error", "-i", str(clip), "-vf", "scale=32:18,format=gray", "-f", "rawvideo",
                        "-"], capture_output=True)
    if p.returncode != 0 or not p.stdout:
        return 0
    fr = np.frombuffer(p.stdout, np.uint8).reshape(-1, 18, 32).astype(np.int16)
    bad = []
    for i in range(1, len(fr) - 1):
        a, b, c = fr[i - 1].mean(), fr[i].mean(), fr[i + 1].mean()
        if b - a > 18 and b - c > 18 and abs(a - c) < 8:
            bad.append(i)
    if not bad:
        return 0
    expr = "+".join(f"eq(n\\,{i})" for i in bad)
    tmp = clip.with_name(clip.stem + "_nf.mp4")
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(clip), "-vf",
                    f"select='not({expr})',fps={FPS}", "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "18",
                    "-pix_fmt", "yuv420p", str(tmp)], check=True, capture_output=True)
    if tmp.exists() and tmp.stat().st_size > 1000:
        shutil.move(str(tmp), str(clip))
    return len(bad)
