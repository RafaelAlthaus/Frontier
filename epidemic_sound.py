#!/usr/bin/env python3
"""epidemic_sound.py — a video's own sound design from Epidemic Sound.

Two things, both from your own Epidemic Sound account (EPIDEMIC_API_KEY — the licence is yours, and what it
downloads is for your videos only):

    sound effects   a fresh kit for the cues the edit already places (whoosh, hit, riser, paper, shutter…), found
                    by search, measured, trimmed onto their attack and levelled. One kit per channel per day, so
                    every video of a batch shares the same sound palette, the way a real show does.
    music           one track per chapter, chosen by the chapter's mood and cut by Epidemic's own editor to the
                    chapter's exact length with a natural ending, crossfaded into one bed under the narration.

A channel opts in with look.sound.epidemic in its style, e.g.

    "epidemic": {"music": {"dramatic": "dark cinematic documentary tension",
                           "quiet": "melancholic ambient piano documentary",
                           "inspiring": "hopeful emotional cinematic documentary"},
                 "sfx_flavor": "cinematic documentary", "avoid": ["comedy", "trap", "edm"]}

Nothing here can fail a video: every error is logged and sfx.py falls back to the sound it always had.

    prepare_sfx(style, look, job, log)       — sound effects into job/sound/sfx/ (run it once the job exists)
    ensure_music(job, look, total, log)      — music plan + edited tracks into job/sound/music/ (at the final mix,
                                               when the chapters sit on their final times); returns the bed file
"""

from __future__ import annotations

import datetime
import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
MCP_URL = "https://www.epidemicsound.com/a/mcp-service/mcp"
SR = 48000
UA = {"User-Agent": "Mozilla/5.0 (Frontier)"}

# the cues the edit places (sfx.cues / kit sound marks) that a recording can replace; instrument voices such as the
# 808 kit stay synthesised. role: (search phrases, min s, max s, kind)
SFX_ROLES = {
    "whoosh":     (["fast cinematic whoosh transition", "short air whoosh swish"], 0.35, 2.2, "whoosh"),
    "whoosh_out": (["soft whoosh away gentle", "subtle swoosh out airy"], 0.35, 2.0, "whoosh"),
    "hit":        (["deep cinematic impact hit", "low boom hit documentary"], 0.8, 5.0, "hit"),
    "riser":      (["cinematic tension riser short", "suspense swell riser"], 1.2, 4.5, "riser"),
    "sting":      (["dramatic short orchestral sting", "suspense stinger hit"], 0.6, 3.5, "hit"),
    "tap":        (["soft wooden tap click", "subtle tick tap"], 0.04, 0.7, "tick"),
    "click":      (["mechanical switch click", "small mechanical click"], 0.04, 0.7, "tick"),
    "typekey":    (["single typewriter key strike", "typewriter key hit"], 0.04, 0.6, "tick"),
    "shutter":    (["vintage camera shutter click", "film camera shutter"], 0.08, 1.2, "tick"),
    "paper":      (["newspaper page turn rustle", "paper sheet slide swipe"], 0.25, 2.0, "whoosh"),
    "ping":       (["soft bell ping notification", "gentle chime ping"], 0.25, 3.0, "hit"),
    "pop":        (["soft pop ui", "small bubble pop"], 0.04, 0.7, "tick"),
    "static":     (["tv static burst short", "radio static noise burst"], 0.25, 1.8, "whoosh"),
    "tape":       (["tape stop rewind short", "cassette tape rewind"], 0.35, 2.5, "whoosh"),
    "cash":       (["cash register ding", "old cash register bell"], 0.25, 2.0, "hit"),
    "crackle":    (["film projector crackle", "old film crackle noise"], 1.5, 6.0, "bed"),
    "hum":        (["low electrical hum", "tube amplifier hum"], 1.5, 6.0, "bed"),
    "crowd":      (["large crowd cheering", "stadium crowd applause"], 2.0, 10.0, "bed"),
}
KEEP_PER_ROLE = 3
MOOD_DEFAULT = {"dramatic": "dark cinematic documentary tension", "quiet": "melancholic ambient piano documentary",
                "inspiring": "hopeful emotional cinematic documentary", "": "cinematic documentary underscore"}
SECTION_MAX_S = 285.0            # Epidemic edits a recording to at most 300 s
SECTION_MIN_S = 25.0
XFADE_S = 1.5


def available() -> bool:
    return bool((os.environ.get("EPIDEMIC_API_KEY") or "").strip())


def settings(look: dict) -> dict:
    """The channel's look.sound.epidemic, or {} when the channel has not asked for it."""
    cfg = ((look or {}).get("sound") or {}).get("epidemic")
    return dict(cfg) if isinstance(cfg, dict) else ({} if not cfg else {"music": {}, "sfx": True})


# ── the MCP connection ───────────────────────────────────────────────────────────────────────────────────────────
class _MCP:
    """Epidemic Sound's MCP server over streamable HTTP: initialize once, then tools/call."""

    def __init__(self):
        self.key = (os.environ.get("EPIDEMIC_API_KEY") or "").strip()
        self.sid, self.n = None, 0
        self._rpc("initialize", {"protocolVersion": "2025-06-18", "capabilities": {},
                                 "clientInfo": {"name": "frontier", "version": "5"}})
        self._rpc("notifications/initialized", notify=True)

    def _rpc(self, method, params=None, notify=False):
        body = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            body["params"] = params
        if not notify:
            self.n += 1
            body["id"] = self.n
        h = {"Authorization": "Bearer " + self.key, "Content-Type": "application/json",
             "Accept": "application/json, text/event-stream", "MCP-Protocol-Version": "2025-06-18"}
        if self.sid:
            h["Mcp-Session-Id"] = self.sid
        req = urllib.request.Request(MCP_URL, data=json.dumps(body).encode(), headers=h, method="POST")
        with urllib.request.urlopen(req, timeout=120) as r:
            self.sid = r.headers.get("Mcp-Session-Id") or self.sid
            raw = r.read().decode("utf-8", "replace")
            ctype = r.headers.get("Content-Type", "")
        if notify or not raw.strip():
            return None
        if "text/event-stream" in ctype:
            msgs = [json.loads(ln[5:].strip()) for ln in raw.splitlines() if ln.startswith("data:") and ln[5:].strip()]
            for m in msgs:
                if m.get("id") == body.get("id"):
                    return m
            return msgs[-1] if msgs else None
        return json.loads(raw)

    def call(self, tool: str, args: dict, tries: int = 3) -> dict:
        """The tool's `data` object. Transient failures are retried; a tool error raises."""
        last = ""
        for k in range(tries):
            try:
                r = self._rpc("tools/call", {"name": tool, "arguments": args}) or {}
                res = r.get("result") or {}
                txt = ((res.get("content") or [{}])[0]).get("text", "")
                if res.get("isError"):
                    last = txt[:240]
                else:
                    data = (json.loads(txt) if txt else {}).get("data")
                    if data:
                        return data
                    last = txt[:240] or "empty result"
            except Exception as e:                      # noqa: BLE001 - network blips are retried
                last = f"{type(e).__name__}: {str(e)[:200]}"
            time.sleep(2 + 3 * k)
        raise RuntimeError(f"epidemic {tool}: {last}")


def _fetch(url: str, dest: Path) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=300) as r, tmp.open("wb") as f:
        shutil.copyfileobj(r, f, 1 << 20)
    tmp.replace(dest)
    return dest


def _decode(path: Path, channels: int = 2) -> np.ndarray:
    p = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-ac", str(channels), "-ar", str(SR), "-f", "f32le", "-"],
                       capture_output=True)
    x = np.frombuffer(p.stdout[: len(p.stdout) // (4 * channels) * (4 * channels)], np.float32)
    return x.reshape(-1, channels).copy()


def _write_wav(path: Path, x: np.ndarray) -> None:
    import wave
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(x.shape[1])
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((np.clip(x, -1, 1) * 32767).astype("<i2").tobytes())


# ── sound effects ────────────────────────────────────────────────────────────────────────────────────────────────
def _shape(x: np.ndarray, kind: str, dmax: float):
    """Trimmed onto its attack (≤10 ms before it), cut to dmax, peak at -3 dBFS, tail faded. None if unusable."""
    if len(x) < SR // 25:
        return None
    mono = np.abs(x).max(axis=1)
    peak = float(mono.max())
    if peak < 1e-4:
        return None
    if kind in ("whoosh", "riser", "bed"):
        above = np.where(mono > peak * 0.02)[0]                  # these swell in: keep the swell, drop dead air only
    else:
        above = np.where(mono > peak * 0.05)[0]                  # -26 dB of peak: the attack
    if not len(above):
        return None
    a = max(0, int(above[0]) - int(0.010 * SR))
    b = min(len(x), a + int(dmax * SR))
    tail = np.where(mono[a:b] > peak * 0.003)[0]
    if len(tail):
        b = min(b, a + int(tail[-1]) + int(0.05 * SR))
    y = x[a:b].copy()
    if len(y) < SR // 25:
        return None
    if kind == "tick" and np.argmax(np.abs(y).max(axis=1)) > int(0.08 * SR):
        return None                                              # a click whose hit comes late lands late
    y *= (10 ** (-3 / 20)) / (np.abs(y).max() + 1e-9)
    k = min(len(y), int(0.012 * SR))
    y[-k:] *= np.linspace(1, 0, k)[:, None]
    if kind == "bed":
        k2 = min(len(y) // 4, int(0.25 * SR))
        y[:k2] *= np.linspace(0, 1, k2)[:, None]
    return y


def _kit_dir(style: str) -> Path:
    try:
        import make_video as mv
        root = Path(mv.OUTPUT_ROOT)
    except Exception:                                   # noqa: BLE001
        root = HERE / "output"
    return root / style / "_work" / "_epidemic" / f"sfx_{datetime.date.today():%Y%m%d}"


def build_kit(style: str, look: dict, log=print) -> Path:
    """This channel's effects for today, found once and reused by every video of the batch."""
    cfg = settings(look)
    kit = _kit_dir(style)
    done = kit / "kit.json"
    if done.exists():
        return kit
    kit.mkdir(parents=True, exist_ok=True)
    flavor = str(cfg.get("sfx_flavor") or "").strip()
    extra_terms = cfg.get("sfx_terms") or {}
    mcp = _MCP()
    index, tmp = {}, Path(tempfile.mkdtemp(prefix="episfx_"))
    try:
        for role, (terms, dmin, dmax, kind) in SFX_ROLES.items():
            phrases = list(extra_terms.get(role) or []) + [f"{t} {flavor}".strip() for t in terms[:1]] + list(terms)
            seen, got = set(), []
            for ph in phrases:
                if len(got) >= KEEP_PER_ROLE:
                    break
                try:
                    data = mcp.call("SearchSoundEffects", {"query": {"term": ph}, "first": 12,
                                                          "filter": {"duration": {"min": int(dmin * 1000),
                                                                                  "max": int(dmax * 3000)}}})
                except RuntimeError as e:
                    log(f"    epidemic: {role} search failed — {str(e)[:90]}")
                    continue
                for node in (data.get("soundEffects") or {}).get("nodes") or []:
                    se = node.get("soundEffect") or node
                    sid = se.get("id")
                    title = str(se.get("title") or "")
                    if not sid or sid in seen or re.search(r"cartoon|comic|funny|kids|game over|8.?bit", title, re.I):
                        continue
                    seen.add(sid)
                    try:
                        dl = mcp.call("DownloadSoundEffect", {"id": sid, "options": {"fileType": "WAV"}})
                        url = (dl.get("soundEffectDownload") or next(iter(dl.values())))["assetUrl"]
                        src = _fetch(url, tmp / f"{sid}.wav")
                        y = _shape(_decode(src), kind, dmax)
                    except Exception as e:              # noqa: BLE001 - try the next one
                        log(f"    epidemic: {role} '{title[:40]}' skipped — {str(e)[:80]}")
                        continue
                    if y is None or len(y) < dmin * SR * 0.5:
                        continue
                    n = len(got) + 1
                    _write_wav(kit / f"{role}_{n}.wav", y)
                    got.append({"file": f"{role}_{n}.wav", "id": sid, "title": title, "seconds": round(len(y) / SR, 2)})
                    if len(got) >= KEEP_PER_ROLE:
                        break
            index[role] = got
            log(f"    epidemic: {role:<10} {len(got)} effect(s)" + (f" — {got[0]['title'][:44]}" if got else ""))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    done.write_text(json.dumps({"style": style, "made": time.strftime("%Y-%m-%d %H:%M"), "roles": index},
                               ensure_ascii=False, indent=1), encoding="utf-8")
    return kit


def prepare_sfx(style: str, look: dict, job: Path, log=print) -> int:
    """Copy the channel's kit of the day into job/sound/sfx/. Returns how many effects the job now has."""
    if not available() or not settings(look):
        return 0
    try:
        kit = build_kit(style, look, log)
    except Exception as e:                              # noqa: BLE001 - the stock sounds stay
        log(f"  epidemic: no sound-effect kit — {type(e).__name__}: {str(e)[:120]}")
        return 0
    dest = job / "sound" / "sfx"
    dest.mkdir(parents=True, exist_ok=True)
    n = 0
    for f in kit.glob("*.wav"):
        if f.name.startswith("."):                      # an exFAT drive's AppleDouble twin, not a sound
            continue
        shutil.copy2(f, dest / f.name)
        n += 1
    shutil.copy2(kit / "kit.json", dest / "kit.json")
    log(f"  epidemic: {n} sound effects for this video (kit {kit.name})")
    return n


# ── music ────────────────────────────────────────────────────────────────────────────────────────────────────────
def _sections(job: Path, total: float) -> list:
    """[(t0, t1, mood, title)] — the chapters on their final times, long ones split at a sentence start."""
    chapters = []
    try:
        chapters = [c for c in json.loads((job / "chapters.json").read_text(encoding="utf-8")) if c.get("t") is not None]
    except (OSError, ValueError):
        pass
    starts = sorted({0.0} | {round(float(c["t"]), 2) for c in chapters if 0 < float(c["t"]) < total - SECTION_MIN_S})
    mood_at = {round(float(c["t"]), 2): str(c.get("mood") or "") for c in chapters}
    title_at = {round(float(c["t"]), 2): str(c.get("title") or "") for c in chapters}
    first_mood = str((chapters[0].get("mood") if chapters else "") or "dramatic")
    # the script's own "[[mood: x]]" lines, placed on the voice (moods.json): one at the very top sets the opening's
    # music, one inside a chapter turns the music there
    try:
        turns = json.loads((job / "moods.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        turns = []
    for r in turns if isinstance(turns, list) else []:
        try:
            t, m = round(float(r.get("t")), 2), str(r.get("mood") or "")
        except (TypeError, ValueError, AttributeError):
            continue
        if not m:
            continue
        if t < SECTION_MIN_S and all(s <= 0 or s > t for s in starts):
            mood_at[0.0] = m
        elif t < total - SECTION_MIN_S and all(abs(t - s) >= SECTION_MIN_S for s in starts):
            starts = sorted(starts + [t])
            mood_at[t] = m
    # sentence starts on the voice's own clock, to split a long chapter where a sentence begins
    cuts = []
    try:
        words = json.loads((job / "words_heard.json").read_text(encoding="utf-8"))
        prev = ""
        for w in words:
            text, t = (str(w[0]), float(w[1])) if isinstance(w, (list, tuple)) else (str(w.get("w")), float(w.get("s")))
            if prev.rstrip().endswith((".", "!", "?", "…")):
                cuts.append(t)
            prev = text
    except (OSError, ValueError, TypeError, IndexError):
        pass
    out = []
    bounds = starts + [total]
    for i in range(len(bounds) - 1):
        a, b = bounds[i], bounds[i + 1]
        mood = mood_at.get(round(a, 2), first_mood if i == 0 else "") or (out[-1][2] if out else first_mood)
        title = title_at.get(round(a, 2), "Intro" if i == 0 else "")
        pieces = max(1, int(np.ceil((b - a) / SECTION_MAX_S)))
        edges = [a]
        for k in range(1, pieces):
            want = a + (b - a) * k / pieces
            near = [c for c in cuts if edges[-1] + SECTION_MIN_S < c < b - SECTION_MIN_S]
            edges.append(min(near, key=lambda c: abs(c - want)) if near else want)
        edges.append(b)
        for k in range(len(edges) - 1):
            out.append([edges[k], edges[k + 1], mood, title])
    merged = []
    for s in out:                                       # a sliver of music is worse than a longer piece
        if merged and s[1] - s[0] < SECTION_MIN_S and merged[-1][1] - merged[-1][0] + (s[1] - s[0]) <= SECTION_MAX_S:
            merged[-1][1] = s[1]
        else:
            merged.append(s)
    return [tuple(s) for s in merged]


def _pick(mcp: _MCP, phrase: str, need_s: float, avoid: set, salt: int, bad_words: list) -> dict:
    """The best recording for one section: no vocals, long enough to edit, not used yet in this video."""
    data = mcp.call("SearchRecordings", {"query": {"term": phrase}, "first": 25,
                                         "filter": {"vocals": False,
                                                    "duration": {"min": int(min(need_s, 150) * 1000)}}})
    cands = []
    for node in (data.get("recordings") or {}).get("nodes") or []:
        r = node.get("recording") or node
        if not r.get("id") or r["id"] in avoid:
            continue
        tags = " ".join(t.get("displayName", "") for t in r.get("tags") or []).lower()
        if any(w in tags or w in str(r.get("title", "")).lower() for w in bad_words):
            continue
        cands.append(r)
    if not cands:
        raise RuntimeError(f"no recording for '{phrase}'")
    # the top of the list is the best match; the job's own salt spreads a batch over the next few
    return cands[salt % min(4, len(cands))]


def _edit(mcp: _MCP, rec_id: str, ms: int, dest: Path) -> Path:
    data = mcp.call("EditRecording", {"id": rec_id, "input": {"targetDurationMs": int(ms), "forceDuration": True,
                                                                "downloadAudioFormat": "MP3", "skipStems": True,
                                                                "maxResults": 1}})
    job_id = (data.get("recordingEdit") or {}).get("id")
    if not job_id:
        raise RuntimeError("no edit job")
    j = {}
    for _ in range(90):
        j = mcp.call("PollEditRecordingJob", {"id": job_id}).get("recordingEditJob") or {}
        if j.get("status") in ("COMPLETED", "FAILED"):
            break
        time.sleep(4)
    if j.get("status") != "COMPLETED":
        raise RuntimeError(f"edit {j.get('status') or 'timed out'}")
    edit_id = (j.get("edit") or {}).get("id")
    if not edit_id:
        raise RuntimeError("edit has no id")
    for k in range(8):                                  # "edit not found" for a few seconds after it completes
        try:
            d = mcp.call("DownloadRecordingEdit", {"input": {"jobId": job_id, "editId": edit_id}}, tries=1)
            return _fetch(d["recordingEditDownload"]["assetUrl"], dest)
        except (RuntimeError, KeyError):
            time.sleep(3 + 2 * k)
    raise RuntimeError("edit could not be downloaded")


def _full_cut(mcp: _MCP, rec_id: str, ms: int, dest: Path) -> Path:
    """When Epidemic's editor fails: the whole track, cut to length here (looped if it is too short) with a fade."""
    d = mcp.call("DownloadRecording", {"id": rec_id, "options": {"fileType": "MP3", "stemType": "FULL"}})
    url = next((v.get("assetUrl") for v in d.values() if isinstance(v, dict) and v.get("assetUrl")), None)
    if not url:
        raise RuntimeError("no full download")
    full = _fetch(url, dest.with_suffix(".full.mp3"))
    s = ms / 1000.0
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-stream_loop", "-1", "-i", str(full), "-t", f"{s:.3f}",
                    "-af", f"afade=t=out:st={max(0.0, s - 3.0):.3f}:d=3", "-c:a", "libmp3lame", "-q:a", "2",
                    str(dest)], check=True)
    full.unlink(missing_ok=True)
    return dest


def _bed(job: Path, plan: list, total: float) -> Path:
    """The section tracks crossfaded into one file of the video's length."""
    out = job / "sound" / "_bed.flac"
    sig = hashlib.sha1(json.dumps([plan, round(total, 2)]).encode()).hexdigest()[:12]
    stamp = job / "sound" / "_bed.sig"
    if out.exists() and stamp.exists() and stamp.read_text().strip() == sig:
        return out
    ins, chain = [], []
    for i, p in enumerate(plan):
        ins += ["-i", str(job / "sound" / "music" / p["file"])]
    if len(plan) == 1:
        filt = "[0:a]aresample=48000,apad[o]"
    else:
        filt, prev = "", "[0:a]"
        for i in range(1, len(plan)):
            lab = f"[x{i}]"
            filt += f"{prev}[{i}:a]acrossfade=d={XFADE_S}:c1=tri:c2=tri{lab};"
            prev = lab
        filt += f"{prev}aresample=48000,apad[o]"
    cmd = ["ffmpeg", "-v", "error", "-y"] + ins + ["-filter_complex", filt, "-map", "[o]", "-t", f"{total:.3f}",
                                                  "-ac", "2", "-ar", str(SR), "-c:a", "flac", str(out)]
    subprocess.run(cmd, check=True, capture_output=True)
    stamp.write_text(sig)
    return out


def ensure_music(job: Path, look: dict, total: float, log=print):
    """The bed for this video, made once its chapters sit on their final times. None when not asked for or failed."""
    cfg = settings(look)
    if not available() or not cfg or cfg.get("music") is False:
        return None
    try:
        sections = _sections(job, total)
        sig = hashlib.sha1(json.dumps([[round(a, 2), round(b, 2), m] for a, b, m, _ in sections]).encode()).hexdigest()[:12]
        plan_f = job / "sound" / "music_plan.json"
        plan = None
        if plan_f.exists():
            got = json.loads(plan_f.read_text(encoding="utf-8"))
            if got.get("sig") == sig and all((job / "sound" / "music" / p["file"]).exists() for p in got["tracks"]):
                plan = got["tracks"]
        if plan is None:
            moods = dict(MOOD_DEFAULT)
            moods.update({k: str(v) for k, v in (cfg.get("music") or {}).items() if isinstance(v, str)})
            bad = [str(w).lower() for w in (cfg.get("avoid") or ["comedy", "funny", "quirky", "cartoon", "kids",
                                                                   "trap", "edm", "christmas", "happy"])]
            salt = int(hashlib.sha1(job.name.encode("utf-8")).hexdigest(), 16)
            mcp = _MCP()
            used, picks = set(), []
            for i, (a, b, mood, title) in enumerate(sections):
                phrase = moods.get(mood) or moods[""]
                rec = _pick(mcp, phrase, b - a, used, salt + i * 7, bad)
                used.add(rec["id"])
                picks.append((i, a, b, mood, title, rec))
            (job / "sound" / "music").mkdir(parents=True, exist_ok=True)

            def one(p):
                i, a, b, mood, title, rec = p
                # every section but the last runs XFADE_S longer: the crossfade eats that much of each join
                ms = int(round(((b - a) + (XFADE_S if i < len(sections) - 1 else 0.0)) * 1000))
                f = f"{i + 1:02d}_{re.sub(r'[^a-z0-9]+', '_', str(rec.get('title', 'track')).lower())[:40]}.mp3"
                try:
                    _edit(_MCP(), rec["id"], ms, job / "sound" / "music" / f)
                except Exception as e:                  # noqa: BLE001 - one track must not cost the whole bed
                    log(f"  epidemic: the editor failed on '{rec.get('title')}' ({type(e).__name__}) — cut here")
                    _full_cut(_MCP(), rec["id"], ms, job / "sound" / "music" / f)
                artists = ", ".join(c["artist"]["name"] for c in rec.get("credits") or []
                                    if c.get("role") == "MAIN_ARTIST" and c.get("artist"))
                return {"t0": round(a, 2), "t1": round(b, 2), "mood": mood, "chapter": title, "file": f,
                        "id": rec["id"], "title": rec.get("title"), "artist": artists, "bpm": rec.get("bpm")}

            with ThreadPoolExecutor(max_workers=4) as ex:
                plan = list(ex.map(one, picks))
            plan_f.parent.mkdir(parents=True, exist_ok=True)
            plan_f.write_text(json.dumps({"sig": sig, "tracks": plan}, ensure_ascii=False, indent=1), encoding="utf-8")
            for p in plan:
                log(f"  music {p['t0']/60:5.1f}–{p['t1']/60:5.1f} min [{p['mood'] or '-'}] "
                    f"{p['title']} — {p['artist']}")
        return _bed(job, plan, total)
    except Exception as e:                              # noqa: BLE001 - the channel's usual music stays
        log(f"  epidemic: music not made — {type(e).__name__}: {str(e)[:140]}")
        return None


def job_sounds(job: Path) -> dict:
    """{role: [files]} — the effects job/sound/sfx/ holds for sfx.mix."""
    d = job / "sound" / "sfx"
    out = {}
    if d.is_dir():
        for f in sorted(d.glob("*.wav")):
            if f.name.startswith("."):
                continue
            role = re.sub(r"_\d+$", "", f.stem)
            out.setdefault(role, []).append(f)
    return out


def credits(job: Path) -> str:
    """One line per track for the description."""
    try:
        plan = json.loads((job / "sound" / "music_plan.json").read_text(encoding="utf-8"))["tracks"]
    except (OSError, ValueError, KeyError):
        return ""
    seen, lines = set(), []
    for p in plan:
        k = (p.get("title"), p.get("artist"))
        if k not in seen:
            seen.add(k)
            lines.append(f"- {p.get('title')} — {p.get('artist') or 'Epidemic Sound'} (Epidemic Sound)")
    return "\n".join(lines)
