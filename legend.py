#!/usr/bin/env python3
"""legend.py — a first-person story in the subject's own (cloned) voice: LEGEND channels.

"John Daly Reveals the 5 Most Special Golfers He Ever Saw" is told BY John Daly. The film opens on a real clip
of him talking (about twenty seconds, on camera, with its own sound), and then his voice — cloned from that very
clip — carries on with the story the script writes in his first person, over real footage and photos. He is
never shown again; the viewer keeps hearing him.

A style turns it on with `"look": {"legend": {...}}`:

    "legend": {"clip_s": 20, "clone": "algrow", "lang": "EN_US"}

What happens, in the order the pipeline calls it:

    prepare(engine, title, job, style)   before the script: Claude names the subject from the title; the
                                         subject's interviews are found on YouTube (soundbites.py: word-timed
                                         captions, free); Claude picks the stretch where THEY talk, on camera,
                                         about something close to the title; it is cut with its sound; the
                                         audio is cloned on Algrow (POST /api/voices/clone, the stealth engine —
                                         up to 30 s of audio); the clone becomes this job's voice, and the words
                                         of the clip are handed to the script as the opening the narration
                                         continues from. Cached in job/legend.json and assets/legend/voices.json,
                                         so a second render clones nothing.
    after_voice(engine, job, mp3, srt, style)   once the voice exists: the clip is cut into the front of the voice
                                         (cinema.apply_pauses) and recorded in soundbites.json, so the timeline
                                         plays it at t=0 with its own sound (cinema._bites_on_timeline).

Everything here is an extra: without a clip the video is made with the style's default voice, in the third person
only if the script chooses so (the prompt still asks for first person — the narrator then is a stand-in).
"""

import json
import re
import subprocess
from pathlib import Path

import requests

HERE = Path(__file__).resolve().parent
VOICES = HERE / "assets" / "legend" / "voices.json"

SUBJECT_PROMPT = """The title of a first-person YouTube video is: "[INSERT TITLE HERE]"

Who is the real, living or historical public person who speaks in it (the "I" of the title)? Return ONLY a JSON
array with one object:
[{"subject": "full name as commonly written", "aliases": ["surname", "nickname"], "field": "the sport or field in
  two words", "topic": "what the person should be heard talking about in the opening clip, in a few words — the theme
  of the title (e.g. 'the golfers he admired', 'his toughest opponents')"}]"""

PICK_PROMPT = """You are the editor of a first-person video titled "[INSERT TITLE HERE]". It opens on a REAL clip of
[INSERT SUBJECT HERE] speaking on camera, then continues in their voice. Choose the opening clip.

Below are the word-timed captions of YouTube videos, as numbered lines with minutes:seconds. Choose ONE stretch of
ONE video, between [INSERT MIN HERE] and [INSERT MAX HERE] seconds long, where [INSERT SUBJECT HERE] THEMSELF speaks
(an interview, a press conference, a podcast — never a narrator, never someone else talking about them, never a
crowd or music) and says something about: [INSERT TOPIC HERE] — or, failing that, anything personal, reflective or
opinionated in complete sentences. Prefer clean speech (few "um"s, no laughter over the words, no crosstalk) — the
voice will be cloned from it.

[INSERT VIDEOS HERE]

Return ONLY a JSON array with one object (or [] when no stretch has the subject speaking):
[{"video": "the video id", "first_words": "the first 3 to 5 words of the stretch, copied exactly from the captions",
  "last_words": "the last 3 to 5 words, copied exactly", "transcript": "the whole stretch, copied from the captions",
  "why": "one short line"}]"""


def _log(mv, msg: str) -> None:
    (mv.log if mv is not None and hasattr(mv, "log") else print)(msg)


def settings(mv, style: str) -> dict:
    look = ((getattr(mv, "STYLE_INFO", {}) or {}).get(style) or {}).get("look") or {}
    cfg = look.get("legend") if isinstance(look.get("legend"), dict) else None
    if cfg is None:
        return {"on": False}
    return {"on": True, "clip_s": float(cfg.get("clip_s") or 20.0), "min_s": float(cfg.get("min_s") or 12.0),
            "max_s": float(cfg.get("max_s") or 28.0), "clone": str(cfg.get("clone") or "algrow").lower(),
            "lang": str(cfg.get("lang") or "EN_US")}


# ── the clip ───────────────────────────────────────────────────────────────────
def _subject(mv, title: str) -> dict:
    try:
        rows = mv._json_items(SUBJECT_PROMPT.replace("[INSERT TITLE HERE]", title), max_tokens=400)
    except SystemExit:
        rows = []
    return rows[0] if rows and isinstance(rows[0], dict) and rows[0].get("subject") else {}


def _pick(mv, title: str, subject: str, topic: str, vids: list, lo: float, hi: float) -> dict:
    import soundbites
    blocks = []
    for v in vids[:soundbites.VIDEOS_MAX]:
        lines = soundbites._lines(v["words"])          # [(second, text)]
        blocks.append(f"VIDEO {v['id']} — {v.get('title', '')[:80]}\n"
                      + "\n".join(f"{k + 1}. [{soundbites._stamp(t)}] {txt}" for k, (t, txt) in enumerate(lines[:260])))
    prompt = (PICK_PROMPT.replace("[INSERT TITLE HERE]", title).replace("[INSERT SUBJECT HERE]", subject)
              .replace("[INSERT TOPIC HERE]", topic or "the theme of the title")
              .replace("[INSERT MIN HERE]", f"{lo:.0f}").replace("[INSERT MAX HERE]", f"{hi:.0f}")
              .replace("[INSERT VIDEOS HERE]", "\n\n".join(blocks)))
    try:
        rows = mv._json_items(prompt, max_tokens=900)
    except SystemExit:
        return {}
    return rows[0] if rows and isinstance(rows[0], dict) and rows[0].get("video") else {}


def find_clip(mv, title: str, job: Path, cfg: dict) -> dict:
    """{subject, aliases, video, a, b, mp4, wav, dur, transcript} — the opening clip, cut with its sound."""
    import soundbites
    work = job / "legend"
    work.mkdir(parents=True, exist_ok=True)
    who = _subject(mv, title)
    if not who:
        _log(mv, "legend: no subject found in the title")
        return {}
    subject = str(who["subject"])
    _log(mv, f"legend: looking for {subject!r} speaking on camera about {who.get('topic', '')!r}...")
    vids = soundbites._candidates(mv, subject, [f"{subject} interview {who.get('topic', '')}",
                                                 f"{subject} talks about {who.get('topic', '')}",
                                                 f"{subject} interview"], work)
    if not vids:
        _log(mv, "legend: no interviews with word-timed captions found")
        return {}
    pick = _pick(mv, title, subject, str(who.get("topic") or ""), vids, cfg["min_s"], cfg["max_s"])
    if not pick:
        _log(mv, "legend: Claude found no stretch with the subject speaking")
        return {}
    v = next((x for x in vids if x["id"] == pick["video"]), None)
    if v is None:
        return {}
    span = soundbites._span(v["words"], str(pick.get("first_words") or ""), str(pick.get("last_words") or ""))
    if not span:
        _log(mv, "legend: the chosen words were not found in the captions")
        return {}
    a, b = span
    a, b = max(0.0, a - 0.35), b + 0.45
    if b - a > cfg["max_s"] + 2:
        b = a + cfg["max_s"] + 1
    dest = work / "opening"
    try:
        got = soundbites.cut(v["id"], a, b, dest, work, zoom=1.0)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError) as e:
        _log(mv, f"legend: the clip could not be cut — {str(e)[:120]}")
        return {}
    if got < cfg["min_s"] * 0.6:
        _log(mv, f"legend: the clip came back too short ({got:.1f} s)")
        return {}
    words = [w for w in v["words"] if w[0] >= a - 0.01 and w[1] <= b + 0.01]
    transcript = " ".join(str(w[2]) for w in words).strip() or str(pick.get("transcript") or "")
    _log(mv, f"legend: opening clip — {v.get('title', '')[:60]!r} {soundbites._stamp(a)}–{soundbites._stamp(b)} ({got:.1f} s)")
    return {"subject": subject, "aliases": who.get("aliases") or [], "field": who.get("field") or "", "video": v["id"],
            "a": round(a, 2), "b": round(b, 2), "mp4": str(dest.with_suffix(".mp4")), "wav": str(dest.with_suffix(".wav")),
            "dur": round(got, 3), "transcript": transcript, "title": v.get("title", "")}


# ── the clone ──────────────────────────────────────────────────────────────────
def _cache() -> dict:
    try:
        return json.loads(VOICES.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _remember(key: str, entry: dict) -> None:
    d = _cache()
    d[key] = entry
    VOICES.parent.mkdir(parents=True, exist_ok=True)
    VOICES.write_text(json.dumps(d, indent=1, ensure_ascii=False), encoding="utf-8")


def _sample(wav: Path, dest: Path, max_s: float) -> Path:
    """The cloning sample: mono 44.1 kHz mp3, at most max_s seconds, levelled."""
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(wav), "-t", f"{max_s:.2f}", "-ac", "1", "-ar", "44100",
                    "-af", "highpass=f=80,loudnorm=I=-18:TP=-2:LRA=9", "-c:a", "libmp3lame", "-b:a", "128k", str(dest)],
                   check=True, capture_output=True)
    return dest


def clone_algrow(mv, sample: Path, name: str, lang: str, transcript: str) -> str:
    """POST /api/voices/clone (the stealth engine): the voice id, used with provider=stealth."""
    key = getattr(mv, "ALGROW_API_KEY", "") or ""
    if not key:
        raise RuntimeError("ALGROW_API_KEY missing")
    base = getattr(mv, "ALGROW_BASE", "https://api.algrow.online")
    with sample.open("rb") as fh:
        r = requests.post(f"{base}/api/voices/clone", headers={"Authorization": f"Bearer {key}"},
                          files={"audioFile": (sample.name, fh, "audio/mpeg")},
                          data={"displayName": name[:60], "langCode": lang, "transcription": transcript[:900],
                                "removeBackgroundNoise": "true"}, timeout=180)
    if r.status_code != 200:
        raise RuntimeError(f"algrow clone HTTP {r.status_code}: {r.text[:200]}")
    d = r.json()
    vid = d.get("voice_id") or (d.get("voice") or {}).get("voice_id") or d.get("id")
    if not vid:
        raise RuntimeError(f"algrow clone: no voice_id in {str(d)[:200]}")
    return str(vid)


def clone_wavespeed(mv, sample: Path, name: str) -> str:
    """WaveSpeed minimax/voice-clone ($0.50): a custom voice id for minimax speech-02-hd."""
    import wavespeed
    import hashlib
    url = wavespeed.upload(sample)
    custom = "frontier" + re.sub(r"[^a-z0-9]", "", name.lower())[:14] + hashlib.sha1(name.encode("utf-8")).hexdigest()[:6]
    try:
        wavespeed.result("minimax/voice-clone", {"audio": url, "custom_voice_id": custom, "model": "speech-02-hd",
                                                 "need_noise_reduction": True, "need_volume_normalization": True,
                                                 "accuracy": 0.8, "language_boost": "English"},
                         label="voice clone", retries=1, timeout_s=600, log=mv.log)
    except Exception as e:                                    # noqa: BLE001
        # the clone answers "completed" with no output (there is no preview text) — the id is the one we sent;
        # and an id that already exists on the account is the clone from an earlier try
        msg = str(e).lower()
        if "without an output" not in msg and "duplicate" not in msg:
            raise
    return custom


def clone(mv, clip: dict, cfg: dict) -> dict:
    """{provider, engine, voice_id} for this subject — cloned once, then remembered."""
    key = re.sub(r"[^a-z0-9]", "", clip["subject"].lower()) + ":" + cfg["clone"]
    got = _cache().get(key)
    if got and got.get("voice_id"):
        _log(mv, f"legend: voice of {clip['subject']} already cloned ({got['voice_id']})")
        return got
    sample = _sample(Path(clip["wav"]), Path(clip["wav"]).with_name("clone_sample.mp3"), min(29.5, cfg["max_s"] + 1))
    order = ["wavespeed", "algrow"] if cfg["clone"] == "wavespeed" else ["algrow", "wavespeed"]
    entry, last = None, None
    for who in order:
        try:
            if who == "wavespeed":
                vid = clone_wavespeed(mv, sample, clip["subject"])
                entry = {"provider": "wavespeed", "engine": "minimax", "voice_id": vid}
            else:
                vid = clone_algrow(mv, sample, f"Frontier — {clip['subject']}", cfg["lang"], clip.get("transcript", ""))
                entry = {"provider": "algrow", "engine": "stealth", "voice_id": vid}
            if entry.get("voice_id"):
                break
        except Exception as e:                                # noqa: BLE001 - the other service may still do it
            last = e
            _log(mv, f"  legend: {who} did not clone the voice — {str(e)[:120]}")
            entry = None
    if not entry:
        raise RuntimeError(str(last or "no cloning service answered"))
    _remember(key, entry)
    _log(mv, f"legend: cloned the voice of {clip['subject']} on {entry['provider']} ({vid})")
    return entry


# ── the hooks ──────────────────────────────────────────────────────────────────
def prepare(mv, title: str, job: Path, style: str) -> dict:
    """Before the script: the clip, the clone, this job's voice, the opening the script continues from."""
    cfg = settings(mv, style)
    if not cfg["on"]:
        return {}
    # the style's own voice first: the app renders job after job in one process, and a person cloned for the
    # last video must not narrate this one when no clip is found
    own = ((getattr(mv, "STYLE_INFO", {}) or {}).get(style) or {}).get("voice") or {}
    if own.get("voice_id"):
        mv.STYLE_VOICE[style] = own["voice_id"]
    for table, key, allowed in ((mv.STYLE_VOICE_PROVIDER, "provider", ("algrow", "ai33", "wavespeed")),
                                (mv.STYLE_VOICE_ENGINE, "engine", ("elevenlabs", "stealth", "minimax")),
                                (mv.STYLE_VOICE_MODEL, "model", None)):
        v = str(own.get(key) or "").strip().lower() if key != "model" else str(own.get(key) or "").strip()
        if v and (allowed is None or v in allowed):
            table[style] = v
        else:
            table.pop(style, None)
    f = job / "legend.json"
    info = {}
    if f.exists():
        try:
            info = json.loads(f.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            info = {}
    if not info.get("mp4") or not Path(info["mp4"]).exists():
        try:
            info = find_clip(mv, title, job, cfg)
        except Exception as e:                            # noqa: BLE001
            _log(mv, f"legend: no opening clip — {type(e).__name__}: {str(e)[:120]}")
            info = {}
        if info:
            f.write_text(json.dumps(info, indent=1, ensure_ascii=False), encoding="utf-8")
    if not info:
        return {}
    if not info.get("voice_id"):
        try:
            info.update(clone(mv, info, cfg))
            f.write_text(json.dumps(info, indent=1, ensure_ascii=False), encoding="utf-8")
        except Exception as e:                            # noqa: BLE001
            _log(mv, f"legend: the voice was not cloned, the style's narrator speaks instead — {str(e)[:140]}")
    if info.get("voice_id"):
        # this job's voice: the tables the voice step reads (styles.py fills them from the style file)
        mv.STYLE_VOICE[style] = info["voice_id"]
        mv.STYLE_VOICE_PROVIDER[style] = info.get("provider") or "algrow"
        if info.get("engine"):
            mv.STYLE_VOICE_ENGINE[style] = info["engine"]
        mv.STYLE_VOICE_MODEL.pop(style, None)
        if info.get("provider") == "wavespeed":
            # the WaveSpeed branch of the voice step reads the style's own voice block: the cloned MiniMax voice goes there
            vb = ((mv.STYLE_INFO.get(style) or {}).setdefault("voice", {}))
            vb["wavespeed_voice"], vb["wavespeed_model"] = info["voice_id"], "minimax/speech-02-hd"
    # the script continues from the clip: its words are the opening the viewer just heard
    extra = (f"THE OPENING CLIP: the video opens on a real clip of {info['subject']} saying, on camera: "
             f"\"{info.get('transcript', '')}\". The narration you write is spoken by {info['subject']} in the first person "
             f"and begins RIGHT AFTER those words — continue the same thought naturally, do not repeat the clip's words, "
             f"do not greet, do not introduce yourself.")
    cur = getattr(mv, "_EXTRA", "") or ""
    if "THE OPENING CLIP:" not in cur:
        mv.set_extra((cur + "\n\n" + extra).strip())
    return info


def clip_cues(mv, job: Path, srt: Path, info: dict) -> int:
    """The opening clip gets its own subtitles: the words YouTube timed for that stretch (soundbites' word cache),
    grouped into short lines and written in front of the narration's cues. Returns the lines added."""
    import re as _re
    import cinema
    try:
        import soundbites
        words = soundbites.words_of(str(info.get("video") or ""), job / "legend")
    except Exception as e:                                    # noqa: BLE001
        _log(mv, f"  legend: no words for the clip's subtitles — {str(e)[:80]}")
        return 0
    a0, b0 = float(info.get("a") or 0), float(info.get("b") or 0)
    inside = [(float(a) - a0, float(b) - a0, str(w)) for a, b, w in words if float(a) >= a0 - 0.05 and float(b) <= b0 + 0.05]
    inside = [(max(0.0, a), max(0.05, b), w) for a, b, w in inside if w.strip()]
    if len(inside) < 3:
        return 0
    groups, cur = [], []
    for a, b, w in inside:
        cur.append((a, b, w))
        if len(cur) >= 6 or cur[-1][1] - cur[0][0] >= 3.6 or _re.search(r"[.!?]$", w):
            groups.append(cur)
            cur = []
    if cur:
        groups.append(cur)
    lines = []
    for k, g in enumerate(groups):
        a, b = g[0][0], max(g[-1][1], g[0][0] + 0.5)
        if k + 1 < len(groups):
            b = min(b, groups[k + 1][0][0])
        text = " ".join(w for _, _, w in g)
        text = text[0].upper() + text[1:] if k == 0 and text else text
        lines.append((a, b, text))
    old_cues = cinema._parse_srt(srt.read_text(encoding="utf-8")) if srt.exists() else []
    cues = [[a, b, t] for a, b, t in lines] + [list(c) for c in old_cues]
    cinema._write_srt(srt, cues)
    _log(mv, f"  legend: {len(lines)} subtitle line(s) for the opening clip")
    return len(lines)


def after_voice(mv, job: Path, mp3: Path, srt: Path, style: str) -> bool:
    """Once the voice exists: the clip in front of it, with its own sound, on the timeline."""
    import cinema
    cfg = settings(mv, style)
    f = job / "legend.json"
    if not cfg["on"] or not f.exists():
        return False
    try:
        info = json.loads(f.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return False
    mp4, wav = Path(str(info.get("mp4") or "")), Path(str(info.get("wav") or ""))
    if not mp4.exists() or not wav.exists():
        return False
    done = job / "legend" / "applied.json"
    sig = f"{mp3.stat().st_size}:{int(mp3.stat().st_mtime)}"
    if done.exists():
        try:
            if json.loads(done.read_text(encoding="utf-8")).get("sig") == sig:
                return False
        except (OSError, ValueError):
            pass
    dur = float(info.get("dur") or 0)
    cinema.apply_pauses(job, mp3, srt, [(0.0, dur + 0.35)])
    clip_cues(mv, job, srt, info)
    ca = job / "chapters_applied.json"
    if ca.exists():
        try:
            d = json.loads(ca.read_text(encoding="utf-8"))
            d["sig"] = f"{mp3.stat().st_size}:{int(mp3.stat().st_mtime)}"
            ca.write_text(json.dumps(d), encoding="utf-8")
        except (OSError, ValueError):
            pass
    rows = []
    sb = job / "soundbites.json"
    if sb.exists():
        try:
            rows = [r for r in json.loads(sb.read_text(encoding="utf-8")) if r.get("kind") != "montage"]
            for r in rows:
                r["t"] = round(float(r["t"]) + dur + 0.35, 3)
        except (OSError, ValueError):
            rows = []
    rows.append({"kind": "montage", "t": 0.0, "dur": round(dur, 3), "mp4": str(mp4), "wav": str(wav),
                 "videos": [info.get("video")], "legend": True})
    rows.sort(key=lambda r: r["t"])
    sb.write_text(json.dumps(rows, indent=1, ensure_ascii=False), encoding="utf-8")
    mp4.with_suffix(".sfx.json").write_text(json.dumps([[0.0, "static", -14.0], [max(0.0, dur - 0.05), "hit", -12.0]]), encoding="utf-8")
    done.parent.mkdir(parents=True, exist_ok=True)
    done.write_text(json.dumps({"sig": f"{mp3.stat().st_size}:{int(mp3.stat().st_mtime)}"}), encoding="utf-8")
    _log(mv, f"legend: the opening clip ({dur:.1f} s of {info.get('subject', '')}) is cut into the front of the voice")
    return True


if __name__ == "__main__":
    import sys
    if sys.argv[1:2] == ["find"]:
        # python legend.py find "John Daly Reveals the 5 Most Special Golfers He Ever Saw"
        import tempfile
        import make_video as mv
        job = Path(tempfile.mkdtemp(prefix="legend_"))
        print(json.dumps(find_clip(mv, " ".join(sys.argv[2:]), job, {"min_s": 12, "max_s": 28}), indent=1))
    else:
        print(__doc__)
