#!/usr/bin/env python3
"""wavespeed.py — WaveSpeed AI for Frontier: upload a picture, run a model, keep the result.

WaveSpeed hosts a thousand models behind one key (WAVESPEED_API_KEY in .env), paid
per run from a prepaid balance. Everything here is three calls:

    upload(path)                 -> a URL the models can read (reference pictures)
    run(model, payload, dest)    -> submits, waits, downloads the first output to dest
    balance()                    -> dollars left

A run that fails for a passing reason (a timeout, a 5xx) is tried again; a run
that fails because the balance is empty stops at once with a plain message — no
retry can pay for it, and four more attempts would only print the same error.
"""

import hashlib
import json
import os
import time
from pathlib import Path

import requests

BASE = os.environ.get("WAVESPEED_BASE", "https://api.wavespeed.ai/api/v3")


class WaveSpeedError(RuntimeError):
    """A run that did not produce a picture."""


class WaveSpeedBalanceError(WaveSpeedError):
    """The WaveSpeed balance cannot pay for the run. Retrying cannot fix it."""


def _key() -> str:
    k = (os.environ.get("WAVESPEED_API_KEY") or "").strip()
    if not k:
        raise WaveSpeedError("WAVESPEED_API_KEY is missing from .env — create a key at "
                             "wavespeed.ai (Dashboard -> Access Keys) and paste it there.")
    return k


def _headers() -> dict:
    return {"Authorization": f"Bearer {_key()}"}


def _broke(status: int, text: str) -> bool:
    t = (text or "").lower()
    return status == 402 or "insufficient" in t or "balance" in t and ("not enough" in t or "low" in t)


def balance() -> float:
    r = requests.get(f"{BASE}/balance", headers=_headers(), timeout=30)
    r.raise_for_status()
    return float((r.json().get("data") or {}).get("balance") or 0.0)


_BAL = {"t": 0.0, "usd": None}


def has_budget(reserve_usd: float = None) -> bool:
    """Whether there is more on the WaveSpeed balance than the reserve kept back (WAVESPEED_RESERVE_USD,
    default $0.50) — checked at most once a minute. With no key or no answer: False."""
    import time as _time
    reserve = float(os.environ.get("WAVESPEED_RESERVE_USD") or 0.5) if reserve_usd is None else reserve_usd
    if not (os.environ.get("WAVESPEED_API_KEY") or "").strip():
        return False
    if _BAL["usd"] is None or _time.time() - _BAL["t"] > 60:
        try:
            _BAL["usd"], _BAL["t"] = balance(), _time.time()
        except Exception:                                   # noqa: BLE001
            return False
    return float(_BAL["usd"]) > reserve


def upload(path: Path, cache_file: Path = None) -> str:
    """A WaveSpeed-hosted URL for a local picture, remembered by its hash so the same
    reference is never uploaded twice for one job."""
    path = Path(path)
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    cache = {}
    if cache_file and Path(cache_file).exists():
        try:
            cache = json.loads(Path(cache_file).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            cache = {}
    if digest in cache:
        return cache[digest]
    last = None
    for attempt in range(3):
        try:
            with path.open("rb") as fh:
                r = requests.post(f"{BASE}/media/upload/binary", headers=_headers(),
                                  files={"file": (path.name, fh)}, timeout=180)
            if r.status_code == 200:
                url = (r.json().get("data") or {}).get("download_url") or ""
                if url.startswith("http"):
                    cache[digest] = url
                    if cache_file:
                        Path(cache_file).write_text(json.dumps(cache, indent=2), encoding="utf-8")
                    return url
            last = f"HTTP {r.status_code} {r.text[:160]}"
        except requests.exceptions.RequestException as e:
            last = str(e)[:160]
        time.sleep(3 * (attempt + 1))
    raise WaveSpeedError(f"upload of {path.name} failed: {last}")


def result(model: str, payload: dict, label: str = "", retries: int = 3, timeout_s: int = 600, log=print) -> dict:
    """Run `model` on `payload` and return WaveSpeed's finished result (status, outputs…)."""
    last = None
    for attempt in range(1, retries + 1):
        try:
            r = requests.post(f"{BASE}/{model}", headers={**_headers(), "Content-Type": "application/json"},
                              json=payload, timeout=120)
            if r.status_code != 200:
                if _broke(r.status_code, r.text):
                    raise WaveSpeedBalanceError(
                        f"WaveSpeed balance is too low for {model} — top up at wavespeed.ai, then run the "
                        f"same title again: everything already made is kept.")
                raise WaveSpeedError(f"{model}: HTTP {r.status_code} {r.text[:200]}")
            pid = (r.json().get("data") or {}).get("id")
            if not pid:
                raise WaveSpeedError(f"{model}: no prediction id in {r.text[:200]}")
            t0 = time.time()
            while True:
                if time.time() - t0 > timeout_s:
                    raise WaveSpeedError(f"{model}: still not done after {timeout_s}s")
                time.sleep(2.5)
                try:
                    g = requests.get(f"{BASE}/predictions/{pid}/result", headers=_headers(), timeout=60)
                except requests.exceptions.RequestException:
                    continue
                d = (g.json().get("data") or {}) if g.status_code == 200 else {}
                st = str(d.get("status") or "").lower()
                if st == "completed":
                    if not d.get("outputs"):
                        raise WaveSpeedError(f"{model}: completed without an output")
                    return d
                if st == "failed":
                    err = str(d.get("error") or "")
                    if _broke(0, err):
                        raise WaveSpeedBalanceError(f"WaveSpeed balance is too low — {err[:120]}")
                    raise WaveSpeedError(f"{model}: failed — {err[:200]}")
        except WaveSpeedBalanceError:
            raise
        except (WaveSpeedError, requests.exceptions.RequestException, ValueError) as e:
            last = e
            if attempt < retries:
                wait = 6 * attempt
                log(f"    wavespeed {label or model}: attempt {attempt}/{retries} failed, retrying in {wait}s — {str(e)[:90]}")
                time.sleep(wait)
    raise WaveSpeedError(f"{label or model} failed after {retries} attempts: {last}")


def download(url: str, dest: Path) -> Path:
    got = requests.get(url, timeout=180)
    got.raise_for_status()
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(got.content)
    return dest


def run(model: str, payload: dict, dest: Path, label: str = "", retries: int = 3,
        timeout_s: int = 600, log=print) -> Path:
    """Run `model` on `payload` and save its first output (a picture, a clip, audio) to `dest`."""
    d = result(model, payload, label, retries, timeout_s, log)
    out = d["outputs"][0]
    url = out if isinstance(out, str) else (out.get("audio") or out.get("url") or out.get("image") or "")
    if not str(url).startswith("http"):
        raise WaveSpeedError(f"{label or model}: the output is not a link ({str(out)[:120]})")
    return download(url, dest)


def _srt_time(t: float) -> str:
    ms = int(round(max(0.0, t) * 1000))
    return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"


def voiceover_minimax(engine, script: str, job: Path, voice: dict, force: bool = False) -> tuple:
    """(audio.mp3, subs.srt) from MiniMax speech-02-hd on WaveSpeed — the model that speaks a voice cloned with
    minimax/voice-clone (legend.py). MiniMax returns no timings, so the subtitles come from faster-whisper on
    the finished voice; the engine respells them from the script afterwards (_script_words_into_srt)."""
    import re
    import shutil
    import subprocess
    mp3, srt = job / "audio.mp3", job / "subs.srt"
    if mp3.exists() and srt.exists() and not force:
        engine.log("cached: audio.mp3 + subs.srt")
        return mp3, srt
    model = voice.get("model") or "minimax/speech-02-hd"
    vdir = job / "voice"
    vdir.mkdir(parents=True, exist_ok=True)
    limit = int(voice.get("chunk_chars") or 2500)
    pieces, cur = [], ""
    for para in re.split(r"(?<=[.!?])\s+", script.strip()):
        if len(cur) + len(para) + 1 > limit and cur:
            pieces.append(cur)
            cur = ""
        cur = (cur + " " + para).strip()
    if cur:
        pieces.append(cur)
    clean = lambda t: re.sub(r"\[[^\]]*\]", "", t)           # [pause] tags mean nothing to MiniMax
    engine.log(f"WaveSpeed voice: {model} ({voice.get('voice_id')}), {len(script)} characters, {len(pieces)} part(s)")

    def record(i):
        part = vdir / f"mm_{i:02d}.mp3"
        if force or not part.exists():
            payload = {"text": clean(pieces[i]), "voice_id": str(voice.get("voice_id")), "speed": float(voice.get("speed", 1.0)),
                       "pitch": 0, "emotion": str(voice.get("emotion") or "neutral"), "format": "mp3", "sample_rate": 44100,
                       "bitrate": 128000, "channel": "1", "language_boost": str(voice.get("language_boost") or "English"),
                       "english_normalization": True}
            run(model, payload, part, label=f"voice {i + 1}", log=engine.log)
        return part

    parts = [record(i) for i in range(len(pieces))]
    if len(parts) == 1:
        shutil.copyfile(parts[0], mp3)
    else:
        lst = vdir / "mm_parts.txt"
        lst.write_text("".join(f"file '{p.resolve()}'\n" for p in parts), encoding="utf-8")
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(lst),
                        "-c:a", "libmp3lame", "-b:a", "192k", str(mp3)], check=True)
    _whisper_srt(engine, mp3, srt)
    return mp3, srt


def _whisper_srt(engine, mp3: Path, srt: Path) -> None:
    """Subtitles for a voice that came back without timings: whisper hears the finished voice word by word,
    grouped into short cues (the engine respells them from the script afterwards, _script_words_into_srt)."""
    import re
    wm = engine._get_whisper()
    engine.log(f"whisper: timing the subtitles on {mp3.name}...")
    segments, _info = wm.transcribe(str(mp3), beam_size=1, word_timestamps=True, vad_filter=True)
    words = []
    for seg in segments:
        for w in (seg.words or []):
            if w.word.strip():
                words.append((w.word.strip(), float(w.start), float(w.end)))
    cues, cur_c = [], []
    for w in words:
        cur_c.append(w)
        if re.search(r"[.!?…]$", w[0]) or len(cur_c) >= 6 or len(" ".join(x[0] for x in cur_c)) >= 32:
            cues.append(cur_c)
            cur_c = []
    if cur_c:
        cues.append(cur_c)
    lines = []
    for k, c in enumerate(cues):
        end = c[-1][2]
        if k + 1 < len(cues) and cues[k + 1][0][1] - end < 0.3:
            end = cues[k + 1][0][1]
        lines.append(f"{k + 1}\n{_srt_time(c[0][1])} --> {_srt_time(end)}\n{' '.join(x[0] for x in c)}\n")
    srt.write_text("\n".join(lines), encoding="utf-8")
    engine.log(f"  voice: {engine._audio_dur(mp3):.1f}s, {len(cues)} subtitle lines")


def voiceover_elevenlabs(engine, script: str, job: Path, voice: dict, force: bool = False) -> tuple:
    """(audio.mp3, subs.srt) from an ElevenLabs model on WaveSpeed that returns audio only — elevenlabs/multilingual-v2
    (voice.wavespeed_model). Multilingual v2 keeps one narrator where v3 slid into other speakers part by part, and
    it takes 10,000 characters a request, so a script of a few minutes is ONE performance with no joins at all.
    Longer scripts go in parts of `chunk_chars` (default 9000) at paragraph breaks, held to one speaker by
    _same_speaker. No timings come back, so the subtitles are whisper's (_whisper_srt)."""
    import shutil
    import subprocess
    mp3, srt = job / "audio.mp3", job / "subs.srt"
    if mp3.exists() and srt.exists() and not force:
        engine.log("cached: audio.mp3 + subs.srt")
        return mp3, srt
    model = voice.get("model")
    vdir = job / "voice"
    vdir.mkdir(parents=True, exist_ok=True)
    limit = min(9500, int(voice.get("chunk_chars") or 9000))
    pieces = [_speakable(x, bool(voice.get("plain_quotes"))) for x in _voice_pieces(script, limit)]
    stability = float(voice.get("stability", 0.5))
    engine.log(f"WaveSpeed voice: {model} ({voice.get('voice_id') or 'Brian'}), {len(script)} characters, "
               f"{len(pieces)} part(s), stability {stability:.2f}")

    def record(i, redo=False):
        part, meta = vdir / f"ml_{i:02d}.mp3", vdir / f"ml_{i:02d}.txt"
        if redo or force or not part.exists() or not meta.exists() or meta.read_text(encoding="utf-8") != pieces[i]:
            payload = {"text": pieces[i], "voice_id": voice.get("voice_id") or "Brian", "stability": stability,
                       "similarity": float(voice.get("similarity", 1.0)), "use_speaker_boost": True}
            run(model, payload, part, label=f"voice {i + 1}", log=engine.log)
            meta.write_text(pieces[i], encoding="utf-8")
        return part, meta

    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=min(4, len(pieces) or 1)) as ex:
        recorded = list(ex.map(record, range(len(pieces))))
    _same_speaker(engine, recorded, record, voice, vdir)
    parts = [p for p, _ in recorded]
    if len(parts) == 1:
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(parts[0]), "-c:a", "libmp3lame", "-b:a", "192k",
                        str(mp3)], check=True)
    else:
        gains, pads, _ = _level_and_pause(parts)
        ins, chains = [], []
        for i, p in enumerate(parts):
            ins += ["-i", str(p)]
            pad = f",apad=pad_dur={pads[i]:.3f}" if i < len(pads) and pads[i] > 0 else ""
            chains.append(f"[{i}:a]aresample=44100,aformat=channel_layouts=mono,volume={gains[i]:.2f}dB{pad}[a{i}]")
        fc = ";".join(chains) + ";" + "".join(f"[a{i}]" for i in range(len(parts))) + f"concat=n={len(parts)}:v=0:a=1[out]"
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *ins, "-filter_complex", fc, "-map", "[out]",
                        "-c:a", "libmp3lame", "-b:a", "192k", str(mp3)], check=True)
    _whisper_srt(engine, mp3, srt)
    return mp3, srt


def _voice_pieces(script: str, limit: int) -> list:
    """The script in parts for separate voice requests, cut where the story itself pauses.

    Each request is performed from scratch, so a part can open a little brighter or darker than the one before
    it; at a paragraph break that reads as a new beat, mid-thought it gives the voice away. Whole paragraphs are
    grouped up to `limit` characters (one alone may run to 1.35 x `limit`); a longer paragraph is cut into
    near-equal runs of whole sentences, and a short last part is folded into the one before it — read on its
    own it came back hurried."""
    import math
    import re
    paras = [p.strip() for p in re.split(r"\n\s*\n", script.strip()) if p.strip()]
    units = []
    for para in paras:
        if len(para) <= limit * 1.35:
            units.append(para)
            continue
        sents = [x for x in re.split(r"(?<=[.!?…])\s+", para) if x]
        n = math.ceil(len(para) / limit)
        target, cur = len(para) / n, ""
        for x in sents:
            if cur and len(cur) + len(x) + 1 > target:
                units.append(cur)
                cur = ""
            cur = (cur + " " + x).strip()
        if cur:
            units.append(cur)
    pieces, cur = [], ""
    for u in units:
        if cur and len(cur) + len(u) + 2 > limit:
            pieces.append(cur)
            cur = ""
        cur = (cur + "\n\n" + u).strip() if cur else u
    if cur:
        pieces.append(cur)
    if len(pieces) > 1 and len(pieces[-1]) < limit * 0.45:
        # pop FIRST: in `pieces[-2] = pieces[-2] + pieces.pop()` the target is resolved after the pop, which wrote
        # the join over the part before (its words never recorded) and kept the last full part (spoken twice)
        last = pieces.pop()
        pieces[-1] = pieces[-1] + "\n\n" + last
    return pieces


def _speakable(text: str, plain_quotes: bool = False) -> str:
    """What the voice is given: markdown emphasis (**bold**, __bold__) never spoken. plain_quotes (voice.plain_quotes):
    quotation marks dropped too — ElevenLabs v3 reads a quoted line as another character and switched speaker on
    the affirmations of a Luz script."""
    import re
    t = re.sub(r"\*\*|__", "", text)
    if plain_quotes:
        t = re.sub(r'[“”«»"]', "", t)
    return t


def _pitch(path: Path) -> float:
    """Median pitch (Hz) of a recorded part: autocorrelation over its voiced 64 ms frames. 0 when unmeasurable."""
    import subprocess
    import numpy as np
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-ac", "1", "-ar", "16000", "-f", "s16le", "-"],
                         capture_output=True).stdout
    x = np.frombuffer(raw, np.int16).astype(np.float32) / 32768
    f0s, lo, hi = [], 16000 // 400, 16000 // 60
    for s0 in range(0, max(0, len(x) - 1024), 800):
        f = x[s0:s0 + 1024]
        f = f - f.mean()
        if np.sqrt((f * f).mean()) < 0.02:
            continue
        ac = np.correlate(f, f, "full")[1023:]
        k = lo + int(np.argmax(ac[lo:hi]))
        if ac[k] > 0.3 * ac[0]:
            f0s.append(16000.0 / k)
    return float(np.median(f0s)) if len(f0s) > 20 else 0.0


def _level_and_pause(parts: list, pause_s: float = 0.55) -> tuple:
    """(gain in dB for each part, silence to add after each part, dB each part opens with before easing to its
    own level): every part brought to the parts' median
    loudness (at most 6 dB either way), and every join given at least `pause_s` of silence, counting the
    silence the parts already carry at their edges — nothing is trimmed, so the word timings stay true."""
    import re
    import statistics
    import subprocess
    import numpy as np

    def loudness(p, ss=None, t=None):
        cut = (["-ss", f"{ss:.3f}"] if ss is not None else []) + (["-t", f"{t:.3f}"] if t else [])
        e = subprocess.run(["ffmpeg", "-v", "info", *cut, "-i", str(p), "-af", "ebur128", "-f", "null", "-"],
                           capture_output=True, text=True, encoding="utf-8", errors="replace").stderr
        m = re.findall(r"I:\s+(-?[0-9.]+) LUFS", e)
        return float(m[-1]) if m else None

    def edges(p):
        raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(p), "-ac", "1", "-ar", "8000", "-f", "f32le", "-"],
                             capture_output=True).stdout
        x = np.abs(np.frombuffer(raw[: len(raw) // 4 * 4], np.float32))
        if not len(x):
            return 0.0, 0.0
        loud = np.nonzero(x > max(1e-4, x.max() * 0.03))[0]
        if not len(loud):
            return 0.0, 0.0
        return loud[0] / 8000.0, (len(x) - 1 - loud[-1]) / 8000.0

    lu = [loudness(p) for p in parts]
    known = [v for v in lu if v is not None and v > -70]
    mid = statistics.median(known) if known else None
    gains = [max(-6.0, min(6.0, mid - v)) if (mid is not None and v is not None and v > -70) else 0.0 for v in lu]
    ed = [edges(p) for p in parts]
    pads = [max(0.0, pause_s - (ed[i][1] + ed[i + 1][0])) for i in range(len(parts) - 1)] + [0.0]
    # the jump is heard at the join, not across a whole part: a part opens where the last one closed (its first
    # seconds against the other's last, both after their gains) and eases back to its own level over ~6 s
    ramps = [0.0]
    for i in range(1, len(parts)):
        try:
            d = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0",
                                      str(parts[i - 1])], capture_output=True, text=True).stdout)
        except ValueError:
            ramps.append(0.0)
            continue
        end, start = loudness(parts[i - 1], max(0.0, d - 8.0), 8.0), loudness(parts[i], 0.0, 8.0)
        ok = end is not None and start is not None and end > -70 and start > -70
        ramps.append(max(-4.0, min(4.0, (end + gains[i - 1]) - (start + gains[i]))) if ok else 0.0)
    return gains, pads, ramps


def _same_speaker(engine, recorded: list, record, voice: dict, vdir: Path) -> None:
    """Every part is a fresh performance, and ElevenLabs v3 now and then answers with another person (a Luz video
    turned into a woman at 3:00). Each part's pitch is held against the narrator's — the median of the parts in the
    voice's own range (voice.gender) — and a part more than 22 % away is recorded again, at most twice, keeping the
    take closest to the narrator. A re-take costs one more request."""
    import shutil
    if len(recorded) < 2:
        return
    f0 = [_pitch(p) for p, _ in recorded]
    g = str(voice.get("gender") or "").lower()
    band = {"male": (65, 160), "female": (150, 300)}.get(g, (60, 400))
    ok = [x for x in f0 if band[0] <= x <= band[1]] or [x for x in f0 if x]
    if not ok:
        return
    ref = sorted(ok)[len(ok) // 2]
    off = lambda x: abs(x / ref - 1) if x else 0.0                       # noqa: E731
    for i, (part, meta) in enumerate(recorded):
        if off(f0[i]) <= 0.22:
            continue
        engine.log(f"  voice part {i + 1}: {f0[i]:.0f} Hz against the narrator's {ref:.0f} Hz — another speaker; "
                   f"recording it again")
        best = (off(f0[i]), part.read_bytes(), meta.read_text(encoding="utf-8"))
        for _ in range(2):
            try:
                record(i, redo=True)
            except Exception as e:                                      # noqa: BLE001
                engine.log(f"    re-take failed: {str(e)[:80]}")
                break
            x = _pitch(part)
            if off(x) < best[0]:
                best = (off(x), part.read_bytes(), meta.read_text(encoding="utf-8"))
            if off(x) <= 0.22:
                engine.log(f"    re-take: {x:.0f} Hz — the narrator again")
                break
        else:
            engine.log(f"    ⚠ part {i + 1} still sounds like another speaker after two re-takes — kept the closest "
                       f"({ref * (1 + best[0]):.0f} Hz); listen around that part")
        part.write_bytes(best[1])
        meta.write_text(best[2], encoding="utf-8")


def voiceover(engine, script: str, job: Path, voice: dict, force: bool = False) -> tuple:
    """(audio.mp3, subs.srt) from ElevenLabs v3 with timings, run on WaveSpeed.

    The model returns every character's start and end, so the subtitles are the script's
    own words on the voice's own clock — no transcription pass, no misspelled names."""
    import re
    import shutil
    import subprocess
    if str(voice.get("model") or "").startswith("minimax/"):
        return voiceover_minimax(engine, script, job, voice, force)
    if str(voice.get("model") or "").startswith("elevenlabs/") and not str(voice.get("model")).endswith("/timing"):
        return voiceover_elevenlabs(engine, script, job, voice, force)
    mp3, srt = job / "audio.mp3", job / "subs.srt"
    if mp3.exists() and srt.exists() and not force:
        engine.log("cached: audio.mp3 + subs.srt")
        return mp3, srt
    model = voice.get("model") or "elevenlabs/eleven-v3/timing"
    vdir = job / "voice"
    vdir.mkdir(parents=True, exist_ok=True)
    # a few sentences per request: ElevenLabs v3 drifts to another voice on a long block, and the
    # parts are recorded side by side
    limit = int(voice.get("chunk_chars") or 1000)
    pieces = [_speakable(x, bool(voice.get("plain_quotes"))) for x in _voice_pieces(script, limit)]
    stability = float(voice.get("stability", 0.5))
    engine.log(f"WaveSpeed voice: {model} ({voice.get('voice_id') or 'Brian'}), {len(script)} characters, "
               f"{len(pieces)} part(s) at paragraph breaks, stability {stability:.2f}")

    def recorded_text(meta: Path) -> str:
        try:
            return "".join(json.loads(meta.read_text(encoding="utf-8")).get("characters") or []).strip()
        except (OSError, ValueError, AttributeError):
            return ""

    def record(i, redo=False):
        part, meta = vdir / f"part_{i:02d}.mp3", vdir / f"part_{i:02d}.json"
        # a part on disk is reused only when it says these very words: the split can move between versions
        if redo or force or not (part.exists() and meta.exists()) or recorded_text(meta) != pieces[i].strip():
            payload = {"text": pieces[i], "voice_id": voice.get("voice_id") or "Brian", "stability": stability,
                       "similarity": float(voice.get("similarity", 1.0)), "use_speaker_boost": True}
            try:
                d = result(model, payload, label=f"voice {i + 1}", log=engine.log)
            except Exception:                                   # noqa: BLE001
                # a model that only takes its three presets (creative 0, natural 0.5, robust 1) gets the nearest
                if stability in (0.0, 0.5, 1.0):
                    raise
                payload["stability"] = round(stability * 2) / 2
                d = result(model, payload, label=f"voice {i + 1}", log=engine.log)
            out = d["outputs"][0]
            download(out["audio"], part)
            meta.write_text(json.dumps(out.get("alignment") or {}), encoding="utf-8")
        return part, meta

    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=min(4, len(pieces) or 1)) as ex:
        recorded = list(ex.map(record, range(len(pieces))))
    _same_speaker(engine, recorded, record, voice, vdir)
    # every part is read on its own, so each comes back a little louder or quieter and with its own silence at
    # the edges: they are levelled to one loudness and joined on a natural pause, so a join is not heard
    gains, pads, ramps = _level_and_pause([p for p, _ in recorded])
    words, parts, offset = [], [], 0.0
    for i, (part, meta) in enumerate(recorded):
        al = json.loads(meta.read_text(encoding="utf-8"))
        w, ws, we = "", None, None
        for ch, a, b in zip(al.get("characters", []), al.get("character_start_times_seconds", []),
                            al.get("character_end_times_seconds", [])):
            if ch.isspace():
                if w:
                    words.append((w, ws + offset, we + offset))
                w, ws = "", None
                continue
            w, ws, we = w + ch, (a if ws is None else ws), b
        if w:
            words.append((w, ws + offset, we + offset))
        parts.append(part)
        offset += engine._audio_dur(part) + (pads[i] if i < len(pads) else 0.0)
    # the audio tags a script carries ([pause], [long pause], [softly]) direct the voice — nobody hears
    # them, so they never reach the subtitles
    kept, in_tag = [], False
    for w, a, b in words:
        if in_tag:
            if "]" not in w:
                continue
            w, in_tag = w.split("]", 1)[1], False
        w = re.sub(r"\[[^\]]*\]", "", w)
        if "[" in w:
            w, in_tag = w.split("[", 1)[0], True
        if w.strip():
            kept.append((w, a, b))
    words = kept
    if len(parts) == 1:
        shutil.copyfile(parts[0], mp3)
    else:
        ins, chains = [], []
        for i, p in enumerate(parts):
            ins += ["-i", str(p)]
            pad = f",apad=pad_dur={pads[i]:.3f}" if i < len(pads) and pads[i] > 0 else ""
            r = ramps[i] if i < len(ramps) else 0.0
            vol = (f"volume='pow(10,({gains[i]:.3f}+({r:.3f})*max(0,1-t/6))/20)':eval=frame" if abs(r) > 0.3
                   else f"volume={gains[i]:.2f}dB")
            chains.append(f"[{i}:a]aresample=44100,aformat=channel_layouts=mono,{vol}{pad}[a{i}]")
        fc = ";".join(chains) + ";" + "".join(f"[a{i}]" for i in range(len(parts))) + f"concat=n={len(parts)}:v=0:a=1[out]"
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *ins, "-filter_complex", fc, "-map", "[out]",
                        "-c:a", "libmp3lame", "-b:a", "192k", str(mp3)], check=True)
        engine.log("  voice parts levelled (" + ", ".join(f"{g:+.1f} dB" for g in gains) + "), each join matched ("
                   + ", ".join(f"{r:+.1f} dB" for r in ramps[1:]) + ") and joined on a pause")
    cues, cur_c = [], []
    for w in words:
        cur_c.append(w)
        if re.search(r"[.!?…]$", w[0]) or len(cur_c) >= 6 or len(" ".join(x[0] for x in cur_c)) >= 32:
            cues.append(cur_c)
            cur_c = []
    if cur_c:
        cues.append(cur_c)
    lines = []
    for k, c in enumerate(cues):
        end = c[-1][2]
        if k + 1 < len(cues) and cues[k + 1][0][1] - end < 0.3:
            end = cues[k + 1][0][1]
        lines.append(f"{k + 1}\n{_srt_time(c[0][1])} --> {_srt_time(end)}\n{' '.join(x[0] for x in c)}\n")
    srt.write_text("\n".join(lines), encoding="utf-8")
    engine.log(f"  voice: {offset:.1f}s, {len(cues)} subtitle lines")
    return mp3, srt
