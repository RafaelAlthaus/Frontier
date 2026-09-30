"""FOLIO's sound: the narration, a soft score under it, and a few sounds of each place — mastered to -14 LUFS.

The reference film has a quiet underscore in D major (a piano and a string pad about 22 dB under the voice, lifting
in the pauses, resolving on a held chord with a low boom and a high shimmer under the end title) and sparse sounds
of the place (wind, a train, an engine). FOLIO writes its score here note by note and synthesises it — a felt
piano, a string pad and a low bass in a generated room — so there is no music file to license. A channel that wants
its own music puts tracks in assets/music/folio/ (or names one in look.sound.track) and they replace the score,
dipped under the voice the same way. The effects come from sfx.py's synthesised bank plus the ambiences below.
"""
from __future__ import annotations

import json
import math
import re
import subprocess
import wave
from pathlib import Path

import numpy as np

SR = 48000
HERE = Path(__file__).resolve().parent


# ── dsp ─────────────────────────────────────────────────────────────────────────────────
def _band(x: np.ndarray, lo: float = None, hi: float = None, order: int = 2) -> np.ndarray:
    """Zero-phase band limiting in the frequency domain (offline, so no IIR loop is needed)."""
    X = np.fft.rfft(x, axis=0)
    f = np.fft.rfftfreq(len(x), 1.0 / SR)
    Hm = np.ones_like(f)
    if hi:
        Hm *= 1.0 / np.sqrt(1.0 + (f / hi) ** (2 * order))
    if lo:
        Hm *= 1.0 / np.sqrt(1.0 + (lo / np.maximum(f, 1e-3)) ** (2 * order))
    return np.fft.irfft(X * (Hm[:, None] if x.ndim == 2 else Hm), n=len(x), axis=0)


def _conv(x: np.ndarray, ir: np.ndarray) -> np.ndarray:
    """Stereo FFT convolution: x (n,) or (n,2), ir (m,2) → (n+m-1, 2)."""
    if x.ndim == 1:
        x = np.stack([x, x], 1)
    n = len(x) + len(ir) - 1
    size = 1 << int(math.ceil(math.log2(n)))
    out = np.fft.irfft(np.fft.rfft(x, size, axis=0) * np.fft.rfft(ir, size, axis=0), size, axis=0)[:n]
    return out


def _room(sec: float = 2.8, seed: int = 5) -> np.ndarray:
    """A warm hall: decorrelated noise tails, highs dying faster than lows, a short pre-delay."""
    n = int(sec * SR)
    t = np.arange(n) / SR
    rng = np.random.default_rng(seed)
    chans = []
    for _ in range(2):
        z = rng.standard_normal(n)
        low, mid, high = _band(z, hi=700), _band(z, lo=700, hi=3500), _band(z, lo=3500)
        ir = 0.6 * low * np.exp(-t * 6.9 / (sec * 0.55)) + mid * np.exp(-t * 6.9 / sec) + 0.5 * high * np.exp(-t * 6.9 / (sec * 0.45))
        ir[: int(0.018 * SR)] = 0.0
        chans.append(ir)
    ir = np.stack(chans, 1)
    return ir / np.sqrt((ir ** 2).sum(0)).max()


def _db(x: float) -> float:
    return 10 ** (x / 20.0)


def _rms(x: np.ndarray) -> float:
    return float(np.sqrt(np.mean(np.square(x)) + 1e-12))


# ── instruments ─────────────────────────────────────────────────────────────────────────
_NAMES = {"C": 0, "C#": 1, "Db": 1, "D": 2, "D#": 3, "Eb": 3, "E": 4, "F": 5, "F#": 6, "Gb": 6, "G": 7, "G#": 8,
          "Ab": 8, "A": 9, "A#": 10, "Bb": 10, "B": 11}


def hz(note: str) -> float:
    m = re.fullmatch(r"([A-G][#b]?)(-?\d)", note)
    k = _NAMES[m.group(1)] + 12 * (int(m.group(2)) + 1)
    return 440.0 * 2 ** ((k - 69) / 12)


def piano(f0: float, vel: float, ring: float, seed: int) -> np.ndarray:
    """A soft felt piano note: inharmonic partials on two slightly detuned strings, each partial dying at its own
    rate (the highs first), a felt hammer's thump, brightness growing with velocity."""
    n = int((ring + 0.05) * SR)
    t = np.arange(n) / SR
    rng = np.random.default_rng(seed)
    B = 0.00032 * (f0 / 262) ** 0.5
    out = np.zeros(n)
    for k in range(1, 16):
        fk = k * f0 * math.sqrt(1 + B * k * k)
        if fk > 9000:
            break
        amp = (1.0 / k ** 1.0) * math.exp(-(k - 1) * (0.30 - 0.22 * vel))
        tau = (3.2 * (262 / f0) ** 0.45) / (1 + 0.42 * (k - 1))
        env = np.exp(-t / tau) * (0.72 + 0.28 * np.exp(-t / 0.35))        # fast then slow decay
        for cents in (-0.6, 0.55):
            ph = rng.uniform(0, 2 * math.pi)
            out += 0.5 * amp * env * np.sin(2 * math.pi * fk * (1 + cents / 1731.0) * t + ph)
    a = int(0.006 * SR)
    out[:a] *= 0.5 - 0.5 * np.cos(np.linspace(0, math.pi, a))
    thump = rng.standard_normal(int(0.03 * SR)) * np.exp(-np.arange(int(0.03 * SR)) / (0.006 * SR))
    out[: len(thump)] += 0.05 * vel * _band(thump, lo=80, hi=900)
    out = _band(out, hi=3200 + 4200 * vel)
    out[-int(0.04 * SR):] *= np.linspace(1, 0, int(0.04 * SR))
    return out * vel


def pad(freqs: list, dur: float, seed: int, attack: float = 1.4, release: float = 2.2, bright: float = 1.0) -> np.ndarray:
    """A string pad: three detuned band-limited saws per note, a slow vibrato, a soft low-pass, slow swells."""
    n = int((dur + release) * SR)
    t = np.arange(n) / SR
    rng = np.random.default_rng(seed)
    left, right = np.zeros(n), np.zeros(n)
    for f in freqs:
        kmax = int(min(28, 5200 * bright / f))
        for v, cents in enumerate((-7.0, 0.0, 6.5)):
            vib = 1 + 0.0021 * np.sin(2 * math.pi * (4.6 + 0.5 * v) * t + rng.uniform(0, 6.3))
            phase = 2 * math.pi * f * (1 + cents / 1731.0) * np.cumsum(vib) / SR
            saw = np.zeros(n)
            for k in range(1, kmax + 1):
                saw += np.sin(k * phase + rng.uniform(0, 0.2)) / k ** 1.15
            pan = 0.5 + (v - 1) * 0.28
            left += saw * math.cos(pan * math.pi / 2)
            right += saw * math.sin(pan * math.pi / 2)
    env = np.clip(t / attack, 0, 1) ** 1.6
    rel = np.clip(1 - (t - dur) / release, 0, 1)
    env *= np.where(t > dur, rel ** 1.5, 1.0)
    x = np.stack([left * env, right * env], 1)
    x = _band(x, lo=90, hi=1500 * bright + 400, order=2)
    return x / (len(freqs) * 3)


def bass(f0: float, dur: float, vel: float = 0.6) -> np.ndarray:
    n = int((dur + 1.0) * SR)
    t = np.arange(n) / SR
    x = (np.sin(2 * math.pi * f0 * t) + 0.25 * np.sin(4 * math.pi * f0 * t)) * np.exp(-t / 2.4)
    x *= np.clip(t / 0.08, 0, 1) * np.where(t > dur, np.clip(1 - (t - dur) / 1.0, 0, 1), 1)
    return x * vel


def bell(f0: float, ring: float = 4.0, seed: int = 9) -> np.ndarray:
    """A soft glass bell for the shimmer under the title."""
    n = int(ring * SR)
    t = np.arange(n) / SR
    rng = np.random.default_rng(seed)
    x = np.zeros(n)
    for r, a, d in ((1.0, 1.0, 2.4), (2.76, 0.42, 1.2), (5.40, 0.2, 0.6), (8.93, 0.1, 0.35)):
        x += a * np.exp(-t / d) * np.sin(2 * math.pi * f0 * r * t + rng.uniform(0, 6))
    x[: int(0.004 * SR)] *= np.linspace(0, 1, int(0.004 * SR))
    return x


def _place(buf: np.ndarray, x: np.ndarray, at: float, gain: float = 1.0) -> None:
    i = int(round(at * SR))
    if i >= len(buf):
        return
    if x.ndim == 1:
        x = np.stack([x, x], 1)
    j0 = max(0, -i)
    i = max(0, i)
    m = min(len(buf) - i, len(x) - j0)
    if m > 0:
        buf[i:i + m] += x[j0:j0 + m] * gain


# ── the score ───────────────────────────────────────────────────────────────────────────
PROG = [  # D major: I – V6 – vi – IV, the reference's key and mood
    ("D", ["D3", "A3", "D4", "F#4", "A4"], "D2"),
    ("A/C#", ["C#3", "A3", "C#4", "E4", "A4"], "C#2"),
    ("Bm", ["B2", "F#3", "B3", "D4", "F#4"], "B1"),
    ("G", ["G2", "D3", "G3", "B3", "D4"], "G1"),
]
CADENCE = [("G", ["G2", "D3", "G3", "B3", "D4"], "G1"), ("A", ["A2", "E3", "A3", "C#4", "E4"], "A1")]
HOME = ("Dadd9", ["D3", "A3", "E4", "F#4", "A4", "D5"], "D2")


def score(total: float, end_t: float, speech: list, seed: int = 11, bpm: float = 68.0) -> np.ndarray:
    """The underscore for a film of `total` seconds whose narration ends (and title lands) at end_t."""
    bar = 4 * 60.0 / bpm
    n = int(total * SR) + SR
    dry = np.zeros((n, 2))
    rng = np.random.default_rng(seed)
    # bars counted back from the home chord, so the cadence lands on the title
    home_t = max(bar * 2, end_t)
    k_before = int(math.ceil(home_t / bar))
    bars = []
    for b in range(k_before):
        t0 = home_t - (k_before - b) * bar
        if b >= k_before - len(CADENCE):
            ch = CADENCE[b - (k_before - len(CADENCE))]
        else:
            ch = PROG[b % len(PROG)]
        bars.append((t0, ch))
    for b, (t0, (name, notes, root)) in enumerate(bars):
        if t0 + bar <= 0:
            continue
        fade_in = 0.35 if b == 0 else 1.0
        chord = pad([hz(x) for x in notes[1:5]], bar + 0.2, seed + b, attack=1.2 if b else 2.2, release=2.0, bright=1.6)
        _place(dry, chord, max(0.0, t0), 0.9 * fade_in)
        _place(dry, bass(hz(root), bar * 0.95, 0.5), max(0.0, t0), 0.22 * fade_in)
        # a broken chord on the piano: quarters, a little late and uneven like a person
        pattern = [notes[1], notes[3], notes[2], notes[4]] if b % 2 == 0 else [notes[1], notes[2], notes[3], notes[2]]
        for q, nt in enumerate(pattern):
            tq = t0 + q * bar / 4 + rng.normal(0, 0.012)
            if tq < 0.3:
                continue
            vel = 0.34 + 0.12 * (q == 0) + rng.normal(0, 0.03)
            _place(dry, piano(hz(nt), float(np.clip(vel, 0.2, 0.6)), 3.2, seed + 97 * b + q), tq, 0.55)
    # home: the chord held under the title, a piano voicing, a low swell and a high shimmer
    name, notes, root = HOME
    hold = max(2.5, total - home_t + 0.5)
    _place(dry, pad([hz(x) for x in notes], hold, seed + 500, attack=0.9, release=2.5, bright=1.25), home_t - 0.15, 1.05)
    _place(dry, bass(hz(root), hold, 0.7), home_t, 0.3)
    for q, nt in enumerate(["D4", "A4", "E5", "F#5"]):
        _place(dry, piano(hz(nt), 0.5 - 0.06 * q, 4.5, seed + 700 + q), home_t + q * 0.18, 0.5)
    _place(dry, bell(hz("A5"), 4.5), home_t + 0.05, 0.10)
    _place(dry, bell(hz("D6"), 4.0, 13), home_t + 0.4, 0.07)
    # the room
    wet = _conv(dry, _room(2.8, seed))[: len(dry)]
    x = dry * 0.72 + wet * 0.55
    # dynamics: a little lower under the words, up in the pauses, a swell into home, a fade at the very end
    t = np.arange(len(x)) / SR
    g = np.full(len(x), 1.0)
    for a, b in speech:
        g[int(a * SR): int(b * SR)] = _db(-3.5)
    k = int(0.6 * SR)
    g = np.convolve(g, np.hanning(k) / np.hanning(k).sum(), mode="same")
    g *= 1 + 0.45 * np.clip((t - (home_t - 2.2)) / 2.2, 0, 1) * (t < home_t + 0.3)
    g *= np.clip((total - t) / 1.6, 0, 1) ** 1.5
    x *= g[:, None]
    return match_eq(x[: int(total * SR)])


# the reference's music between the sentences, per octave band (63 Hz … 8 kHz), dB against its loudest band
REF_BANDS = [(63, -7.0), (125, -1.0), (250, -1.2), (500, -0.6), (1000, 0.0), (2000, -4.1), (4000, -8.8), (8000, -14.0)]


def match_eq(x: np.ndarray, target=REF_BANDS, limit: float = 20.0) -> np.ndarray:
    """Tilt a mix toward the reference's tonal balance: measure its octave bands, and apply the (smoothed, bounded)
    difference as one zero-phase EQ curve."""
    mono = x.mean(1) if x.ndim == 2 else x
    X = np.abs(np.fft.rfft(mono)) ** 2
    f = np.fft.rfftfreq(len(mono), 1.0 / SR)
    cur = []
    for c, _ in target:
        m = (f >= c / math.sqrt(2)) & (f < c * math.sqrt(2))
        cur.append(10 * math.log10(X[m].sum() + 1e-20))
    cur = np.array(cur) - max(cur)
    want = np.array([v for _, v in target])
    corr = np.clip(want - cur, -limit, limit)
    corr -= corr.max()                                  # only ever cut, never boost into clipping
    logc = np.log2([c for c, _ in target])
    lf = np.log2(np.maximum(f, 20.0))
    gdb = np.interp(lf, logc, corr, left=corr[0], right=corr[-1])
    G = 10 ** (gdb / 20.0)
    Y = np.fft.rfft(x, axis=0) * (G[:, None] if x.ndim == 2 else G)
    return np.fft.irfft(Y, n=len(x), axis=0)


# ── ambiences ──────────────────────────────────────────────────────────────────────────
AMBIENT_WORDS = {
    "wind": ("wind", "desert", "dune", "sand", "breeze", "beach", "cliff", "plain", "noon sun"),
    "sea": ("sea", "wave", "harbour", "harbor", "shore", "ocean", "port", "ship"),
    "room": ("library", "room", "interior", "inside", "study", "hall", "workshop", "office", "shop", "chamber"),
    "fire": ("lamp", "fire", "candle", "torch", "hearth", "lantern"),
    "drip": ("well", "drip", "cistern", "cave"),
    "space": ("space", "orbit", "satellite", "earth from", "stars", "planet", "moon"),
    "birds": ("courtyard", "garden", "birds", "gull", "morning", "trees", "square"),
    "crowd": ("crowd", "market", "street", "busy", "people"),
}


def _noise(n: int, seed: int) -> np.ndarray:
    return np.random.default_rng(seed).standard_normal(n)


def ambience(kind: str, dur: float, seed: int) -> np.ndarray:
    """A stereo bed of a place, normalised to RMS 1 (levels are set by the mix)."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    if n <= 0:
        return np.zeros((0, 2))
    if kind == "wind":
        z = np.stack([_band(_noise(n, seed), lo=120, hi=900), _band(_noise(n, seed + 1), lo=120, hi=900)], 1)
        whistle = _band(_noise(n, seed + 2), lo=700, hi=1300, order=4)
        slow = 0.55 + 0.45 * np.interp(t, np.linspace(0, dur, max(2, int(dur / 1.3))),
                                       np.random.default_rng(seed).uniform(0, 1, max(2, int(dur / 1.3))))
        x = (z + 0.25 * whistle[:, None]) * slow[:, None]
    elif kind == "sea":
        z = np.stack([_band(_noise(n, seed), lo=80, hi=2600), _band(_noise(n, seed + 1), lo=80, hi=2600)], 1)
        waves = 0.35 + 0.65 * np.clip(np.sin(2 * math.pi * t / 6.5 + 1.2) * 0.5 + 0.5, 0, 1) ** 2.2
        x = z * waves[:, None]
    elif kind == "room":
        z = np.stack([_band(_noise(n, seed), hi=260), _band(_noise(n, seed + 1), hi=260)], 1)
        x = z
    elif kind == "fire":
        x = np.stack([_band(_noise(n, seed), lo=200, hi=1600), _band(_noise(n, seed + 1), lo=200, hi=1600)], 1) * 0.25
        rng = np.random.default_rng(seed)
        for tk in np.cumsum(rng.exponential(0.09, int(dur / 0.05))):
            if tk >= dur:
                break
            k = int(tk * SR)
            m = min(n - k, int(0.012 * SR))
            click = rng.standard_normal(m) * np.exp(-np.arange(m) / (0.002 * SR)) * rng.uniform(0.5, 2.5)
            x[k:k + m] += click[:, None] * np.array([rng.uniform(.3, 1), rng.uniform(.3, 1)])
        x = _band(x, lo=300, hi=5000)
    elif kind == "drip":
        x = np.stack([_band(_noise(n, seed), hi=200), _band(_noise(n, seed + 1), hi=200)], 1) * 0.35
        rng = np.random.default_rng(seed)
        tk = 0.4 + rng.uniform(0, 0.8)
        while tk < dur - 0.3:
            m = int(0.25 * SR)
            tt = np.arange(m) / SR
            f = 1500 * (1 - 0.35 * np.clip(tt / 0.02, 0, 1))
            drop = np.sin(2 * math.pi * np.cumsum(f) / SR) * np.exp(-tt / 0.04)
            _place(x, drop, tk, 2.0)
            tk += rng.uniform(1.1, 2.3)
        x = x[:n] + 0.8 * _conv(x[:n, 0], _room(1.8, seed + 3))[:n]
    elif kind == "space":
        drone = np.sin(2 * math.pi * 55 * t) + 0.6 * np.sin(2 * math.pi * 82.6 * t + 0.4) + 0.3 * np.sin(2 * math.pi * 110.4 * t)
        drone *= 0.7 + 0.3 * np.sin(2 * math.pi * 0.11 * t)
        air = np.stack([_band(_noise(n, seed), lo=200, hi=1200), _band(_noise(n, seed + 1), lo=200, hi=1200)], 1)
        x = drone[:, None] * 0.8 + air * 0.25
    elif kind == "birds":
        x = np.stack([_band(_noise(n, seed), lo=150, hi=700), _band(_noise(n, seed + 1), lo=150, hi=700)], 1) * 0.4
        rng = np.random.default_rng(seed)
        tk = rng.uniform(0.2, 1.0)
        while tk < dur - 0.4:
            for c in range(rng.integers(2, 5)):
                m = int(rng.uniform(0.05, 0.11) * SR)
                tt = np.arange(m) / SR
                f0 = rng.uniform(2800, 4600)
                f = f0 * (1 + 0.25 * np.sin(math.pi * tt / tt[-1])) + rng.uniform(-300, 300) * tt / tt[-1]
                chirp = np.sin(2 * math.pi * np.cumsum(f) / SR) * np.sin(math.pi * tt / tt[-1]) ** 2
                pan = rng.uniform(0.2, 0.8)
                _place(x, np.stack([chirp * math.cos(pan * 1.57), chirp * math.sin(pan * 1.57)], 1), tk + c * rng.uniform(0.09, 0.16), 1.3)
            tk += rng.uniform(1.4, 3.2)
    elif kind == "crowd":
        x = np.zeros((n, 2))
        rng = np.random.default_rng(seed)
        for v in range(10):
            syl = np.interp(t, np.arange(0, dur + 0.3, 0.19), rng.uniform(0, 1, len(np.arange(0, dur + 0.3, 0.19)))) ** 3
            vo = _band(_noise(n, seed + 10 + v), lo=rng.uniform(250, 450), hi=rng.uniform(1600, 2800)) * syl
            pan = rng.uniform(0.1, 0.9)
            x += np.stack([vo * math.cos(pan * 1.57), vo * math.sin(pan * 1.57)], 1)
    else:
        return np.zeros((n, 2))
    x = x[:n]
    return x / (_rms(x) + 1e-9)


AMB_DB = {"wind": -27, "sea": -27, "room": -34, "fire": -31, "drip": -26, "space": -26, "birds": -31, "crowd": -32}


def _kinds_for(shot: dict) -> list:
    txt = " ".join(str(shot.get(k) or "") for k in ("sound", "picture")).lower()
    if re.search(r"\b(paper|diagram|fig\.?|sheet|drawing on)\b", txt) and not shot.get("sound"):
        return []
    got = []
    for kind, words in AMBIENT_WORDS.items():
        if any(w in txt for w in words):
            got.append(kind)
    return got[:2]


# ── the whole soundtrack ─────────────────────────────────────────────────────────────────
def _read(path: Path, channels: int = 2) -> np.ndarray:
    p = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-f", "f32le", "-ac", str(channels), "-ar", str(SR), "-"],
                       capture_output=True)
    return np.frombuffer(p.stdout, np.float32).reshape(-1, channels).astype(np.float64)


def _write(path: Path, x: np.ndarray) -> None:
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((np.clip(x, -1, 1) * 32767).astype("<i2").tobytes())


def _own_music(engine, style: str) -> Path | None:
    look = ((engine.STYLE_INFO.get(style) or {}).get("look") or {}) if engine is not None else {}
    snd = look.get("sound") or {}
    if snd.get("music") is False:
        return None
    try:
        import sfx
        tr = snd.get("track")
        if tr:
            p = sfx.MUSIC / tr
            if p.exists():
                return p
        got = sfx._tracks(style)
        return got[0] if got and (sfx.MUSIC / style).is_dir() else None
    except Exception:                                   # noqa: BLE001 - the score is the fallback
        return None


def soundtrack(engine, job: Path, mp3: Path, scenes: list, rows: list, total: float, style: str,
               lead: float = 0.8) -> Path:
    log = engine.log if engine is not None else print
    out = job / "_folio_sound.wav"          # in the job folder itself: the final mux opens its audio by file name there
    voice = _read(mp3)
    vox = np.zeros((int(total * SR), 2))
    _place(vox, voice, lead)
    speech = []
    for sc in scenes:
        for w in sc["words"]:
            a, b = sc["t0"] + w["t0"], sc["t0"] + w["t1"]
            if speech and a - speech[-1][1] < 0.28:
                speech[-1][1] = b
            else:
                speech.append([a, b])
    v_db = 20 * math.log10(_rms(np.concatenate([vox[int(a * SR):int(b * SR)] for a, b in speech]) if speech else vox) + 1e-9)
    end_t = (speech[-1][1] + 0.45) if speech else total - 3
    # music: the channel's own track, or the written score
    own = _own_music(engine, style)
    if own is not None:
        log(f"FOLIO sound: music {own.name}")
        m = _read(own)
        reps = int(math.ceil(len(vox) / max(1, len(m))))
        music = np.tile(m, (reps, 1))[: len(vox)]
        t = np.arange(len(music)) / SR
        music *= (np.clip(t / 2.0, 0, 1) * np.clip((total - t) / 2.5, 0, 1))[:, None]
    else:
        log("FOLIO sound: writing the score (piano, strings, bass in D major)...")
        music = score(total, end_t, speech, seed=int(abs(hash(job.name)) % 1000))
    m_db = 20 * math.log10(_rms(music[int(lead * SR): int(end_t * SR)]) + 1e-9)
    music *= _db(v_db - 21.0 - m_db)                     # ~21 dB under the narration, lifted in the pauses by score()
    fx = np.zeros_like(vox)
    # ambiences, shot by shot, crossfaded at the cuts
    for i, (sc, row) in enumerate(zip(scenes, rows)):
        kinds = _kinds_for(row["shot"])
        a, b = row["a"], row["b"]
        for kind in kinds:
            bed = ambience(kind, b - a + 0.8, 101 + 7 * i)
            k = int(0.4 * SR)
            env = np.ones(len(bed))
            env[:k] = np.linspace(0, 1, k)
            env[-k:] = np.linspace(1, 0, k)
            _place(fx, bed * env[:, None] * _db(v_db + AMB_DB[kind] + 6), a - 0.2)
    # transitions and the title
    import sfx
    sfx_lvl = _db(v_db - 17.0)
    for i, sc in enumerate(scenes[1:], 1):
        kind = sc["in"].get("kind")
        cut = rows[i]["a"]
        if kind in ("whip", "tilt"):
            s, pk = sfx.whoosh(dur=0.8, seed=31 + i)
            _place(fx, s, cut - pk, sfx_lvl * 0.9)
        elif kind == "push":
            s, pk = sfx.whoosh(dur=1.0, seed=41 + i)
            _place(fx, s, cut - pk, sfx_lvl * 0.75)
        elif kind in ("cover", "reveal", "wipe"):
            s, pk = sfx.paper(seed=51 + i)
            _place(fx, s, cut - 0.05, sfx_lvl * 0.8)
        elif kind == "whiteout":
            s, pk = sfx.riser(dur=1.4, seed=61 + i)
            _place(fx, s, cut - pk, sfx_lvl * 0.45)
            s, pk = sfx.whoosh(dur=1.2, seed=62 + i)
            _place(fx, s, cut - pk, sfx_lvl * 0.5)
        elif kind == "bloom":
            _place(fx, np.stack([bell(hz("A5"), 2.5, 70 + i)] * 2, 1) * 0.5, cut - 0.1, sfx_lvl * 0.35)
    s, _ = sfx.hit(dur=2.6, seed=77, deep=0.85)
    _place(fx, s, end_t, sfx_lvl * 0.55)
    mix = vox + music + fx
    peak = np.abs(mix).max()
    if peak > 0.98:
        mix *= 0.98 / peak
    out.parent.mkdir(parents=True, exist_ok=True)
    _write(out, mix)
    try:
        sfx.master(out, log=log, target=-14.0)
    except Exception as e:                               # noqa: BLE001 - an unmastered track still plays
        log(f"  mastering skipped: {str(e)[:80]}")
    (job / "folio" / "sound.json").write_text(json.dumps({"voice_db": round(v_db, 1), "end_t": round(end_t, 2),
                                                           "music": own.name if own else "score"}, indent=1), encoding="utf-8")
    return out
