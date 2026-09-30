#!/usr/bin/env python3
"""sfx.py — sound design under the edit, and a music bed ducked under the voice.

Options → Sound design. For every scene the edit cuts to, the sound follows the picture:

    a whoosh that peaks on the cut into a graphic, a map, a real photo or object, and a softer one out
    a low, warm hit where a figure lands, a date appears or the story turns
    a riser that arrives exactly on a chapter question
    soft taps as the events of a timeline appear, paper for headlines and collage
    a deep hit under the first frame of the cold open

Every effect is synthesised right here from filtered noise and tones — there are no sound files to
license and nothing to download. They sit well under the narration (look.sound.sfx_db).

Music is never bundled. Put tracks you have the rights to in assets/music/<channel>/ (or straight
in assets/music/) and they play under the whole video, fading in and out and dipping every time
the narrator speaks (look.sound.music_db, look.sound.duck_db).

Listen to every effect without making a video (writes preview/sfx/*.wav):

    python sfx.py preview
"""

import json
import math
import os
import re
import shutil
import subprocess
import sys
import wave
import zlib
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
SR = 48000
MUSIC = HERE / "assets" / "music"
# music_rel_db: the bed between sentences, in dB against the narration's own loudness — every track sits at the
# same place whatever level it was mastered at (music_db is the fixed gain used when either cannot be measured)
DEFAULTS = {"sfx_db": -19.0, "music_db": -18.0, "music_rel_db": -6.0, "duck_db": -6.0, "music": True,
            # the opening can carry the music: intro_s seconds at intro_db, then after_db ("off" = silence) for the
            # rest, crossing over in intro_fade_s — 0 keeps one level under the whole video
            "intro_s": 0.0, "intro_db": 0.0, "after_db": 0.0, "intro_fade_s": 6.0}


def _active_db(path: Path, seconds: float = 90.0, channels: int = 1):
    """The loudness of the audible part of a file (dBFS RMS over its sounding blocks), or None — decoded with
    the channel count it is mixed with, so a stereo song and the mono voice are measured alike."""
    p = subprocess.run(["ffmpeg", "-v", "error", "-t", f"{seconds:.0f}", "-i", str(path), "-ac", str(channels), "-ar", "8000",
                        "-f", "f32le", "-"], capture_output=True)
    x = np.frombuffer(p.stdout[: len(p.stdout) // 4 * 4], np.float32)
    if len(x) < 8000:
        return None
    k = len(x) // 400
    r = np.sqrt(np.mean(x[: k * 400].reshape(k, 400) ** 2, axis=1) + 1e-12)
    loud = r[r > 10 ** (-45 / 20)]
    return float(20 * np.log10(np.sqrt(np.mean(loud ** 2)))) if len(loud) > 20 else None


def _db(x: float) -> float:
    return float(10 ** (x / 20.0))


# ── synthesis ─────────────────────────────────────────────────────────────────
def _band_noise(n: int, centers, widths, seed: int, frame: int = 1024, hop: int = 256) -> np.ndarray:
    """Noise whose pass band moves over time: `centers`/`widths` in Hz, spread evenly across the
    sound. Built frame by frame in the frequency domain and overlap-added."""
    rng = np.random.default_rng(seed)
    frames = int(math.ceil(n / hop)) + 4
    freqs = np.fft.rfftfreq(frame, 1.0 / SR)
    tt = np.linspace(0, 1, frames)
    c = np.interp(tt, np.linspace(0, 1, len(centers)), centers)
    w = np.interp(tt, np.linspace(0, 1, len(widths)), widths)
    mag = np.exp(-0.5 * ((freqs[None, :] - c[:, None]) / np.maximum(w[:, None], 20.0)) ** 2)
    spec = mag * np.exp(1j * rng.uniform(0, 2 * np.pi, mag.shape))
    blocks = np.fft.irfft(spec, n=frame, axis=1) * np.hanning(frame)[None, :]
    out = np.zeros(frames * hop + frame)
    for i in range(frames):
        out[i * hop:i * hop + frame] += blocks[i]
    out = out[frame // 2: frame // 2 + n]
    return out / (np.abs(out).max() + 1e-9)


def _space(x: np.ndarray, seconds: float, mix: float, seed: int) -> np.ndarray:
    """A short, dark room around a mono sound (FFT convolution with a decaying noise tail)."""
    n = int(seconds * SR)
    t = np.arange(n) / SR
    ir = _band_noise(n, [2200, 900, 400], [1800, 900, 400], seed) * np.exp(-t * 6.9 / seconds)
    size = 1 << int(math.ceil(math.log2(len(x) + n)))
    wet = np.fft.irfft(np.fft.rfft(x, size) * np.fft.rfft(ir, size), size)[: len(x) + n]
    wet /= (np.abs(wet).max() + 1e-9)
    dry = np.concatenate([x, np.zeros(n)])
    return dry * (1 - mix) + wet * mix * np.abs(x).max()


def _stereo(x: np.ndarray, pan=None, width: float = 0.0, seed: int = 0) -> np.ndarray:
    if pan is None:
        pan = np.full(len(x), 0.5)
    left, right = x * np.cos(pan * np.pi / 2), x * np.sin(pan * np.pi / 2)
    if width > 0:                                   # a few ms apart: wide, not doubled
        d = int(0.006 * SR)
        right = np.concatenate([np.zeros(d), right])[: len(x)] * (1 - width) + right * width
    out = np.stack([left, right], 1) * math.sqrt(2)
    return (out / (np.abs(out).max() + 1e-9)).astype(np.float32)


def whoosh(dur: float = 1.15, seed: int = 1, up: bool = True) -> tuple:
    """(sound, peak second) — air moving past, rising into the cut."""
    n = int(dur * SR)
    t = np.linspace(0, 1, n)
    peak = 0.64
    x = _band_noise(n, [260, 700, 2400, 3000, 1100, 420], [140, 380, 1300, 1600, 700, 260], seed)
    x += 0.35 * _band_noise(n, [90, 160, 260, 180, 90], [50, 90, 140, 90, 50], seed + 7)
    env = np.where(t < peak, (t / peak) ** 2.4, np.exp(-(t - peak) * 7.5))
    pan = np.clip(0.15 + t * 0.7, 0, 1) if up else np.clip(0.85 - t * 0.7, 0, 1)
    return _stereo(x * env, pan, 0.3, seed), dur * peak


def hit(dur: float = 2.8, seed: int = 2, deep: float = 1.0) -> tuple:
    """(sound, 0.0) — a low, warm impact with a short room."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = (36 + 46 * np.exp(-t * 16)) * deep
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 2.4)
    knock = _band_noise(n, [2600, 900, 300], [1900, 700, 220], seed) * np.exp(-t * 48)
    air = _band_noise(n, [220, 150, 110], [140, 100, 70], seed + 1) * np.exp(-t * 1.5)
    x = body * 0.95 + knock * 0.28 + air * 0.3
    x[: int(0.004 * SR)] *= np.linspace(0, 1, int(0.004 * SR))
    x = _space(x, 1.6, 0.22, seed + 3)[:n]
    return _stereo(x, None, 0.5, seed), 0.0


def riser(dur: float = 2.3, seed: int = 3) -> tuple:
    """(sound, last second) — builds to the moment it ends on."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    k = t / dur
    noise = _band_noise(n, [380, 900, 2300, 5200], [200, 520, 1400, 3000], seed)
    f = 150 * 2 ** (k * 2.4)
    tone = np.sin(2 * np.pi * np.cumsum(f) / SR) * (0.22 + 0.1 * np.sin(2 * np.pi * 5.5 * t))
    x = (noise * 0.85 + tone) * k ** 2.7
    x[-int(0.02 * SR):] *= np.linspace(1, 0, int(0.02 * SR))
    return _stereo(x, np.clip(0.5 + 0.25 * np.sin(2 * np.pi * 0.6 * t), 0, 1), 0.4, seed), dur


def tap(seed: int = 4) -> tuple:
    """(sound, 0.0) — a small wooden tick for a dot on a timeline."""
    n = int(0.42 * SR)
    t = np.arange(n) / SR
    x = (np.sin(2 * np.pi * 820 * t) * 0.6 + np.sin(2 * np.pi * 1640 * t) * 0.25) * np.exp(-t * 26)
    x += _band_noise(n, [3500, 1800], [1500, 900], seed) * np.exp(-t * 120) * 0.5
    x = _space(x, 0.5, 0.15, seed)[:n]
    return _stereo(x, None, 0.2, seed), 0.0


def paper(dur: float = 0.75, seed: int = 5) -> tuple:
    """(sound, 0.25) — a sheet sliding onto a table."""
    n = int(dur * SR)
    t = np.linspace(0, 1, n)
    x = _band_noise(n, [2400, 4800, 3600, 2000], [1500, 2600, 2000, 1200], seed)
    rng = np.random.default_rng(seed)
    grain = np.interp(np.arange(n), np.linspace(0, n, 40), rng.uniform(0.45, 1.0, 40))
    env = np.where(t < 0.3, (t / 0.3) ** 1.6, np.exp(-(t - 0.3) * 6))
    return _stereo(x * env * grain, np.clip(0.3 + t * 0.4, 0, 1), 0.25, seed), dur * 0.3


def shutter(seed: int = 6) -> tuple:
    """(sound, 0.0) — a 35 mm camera: the mirror slaps, the shutter snaps 70 ms later, a tiny spring rings out."""
    n = int(0.32 * SR)
    t = np.arange(n) / SR
    slap = _band_noise(n, [1800, 900, 500], [1400, 700, 300], seed) * np.exp(-t * 95)
    snap_t = np.clip(t - 0.07, 0, None)
    snap = _band_noise(n, [4200, 2600, 1200], [2600, 1600, 700], seed + 2) * np.exp(-snap_t * 140) * (t >= 0.07)
    ring = np.sin(2 * np.pi * 3100 * t) * np.exp(-snap_t * 60) * (t >= 0.07) * 0.18
    x = slap * 0.7 + snap + ring
    x[: int(0.002 * SR)] *= np.linspace(0, 1, int(0.002 * SR))
    x = _space(x, 0.35, 0.12, seed + 4)[:n]
    return _stereo(x, None, 0.15, seed), 0.0


def click(seed: int = 7) -> tuple:
    """(sound, 0.0) — one dry relay click, for a photo changing on a contact strip."""
    n = int(0.12 * SR)
    t = np.arange(n) / SR
    x = _band_noise(n, [3200, 1600], [2200, 900], seed) * np.exp(-t * 180)
    x += np.sin(2 * np.pi * 2400 * t) * np.exp(-t * 120) * 0.3
    return _stereo(x, None, 0.1, seed), 0.0


def tape(dur: float = 1.15, seed: int = 8) -> tuple:
    """(sound, last 0.15 s) — a VHS deck taking the cassette: a motor whir winds up, the mechanism clunks home."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    k = t / dur
    whir = _band_noise(n, [140, 260, 420, 380], [60, 120, 200, 160], seed) * (0.25 + 0.75 * k ** 1.5)
    hum = np.sin(2 * np.pi * (58 + 40 * k) * t) * 0.12 * k
    clunk_t = np.clip(t - (dur - 0.15), 0, None)
    clunk = (_band_noise(n, [900, 300, 150], [700, 250, 120], seed + 3) * np.exp(-clunk_t * 55) * (t >= dur - 0.15)
             + np.sin(2 * np.pi * 70 * clunk_t) * np.exp(-clunk_t * 22) * (t >= dur - 0.15) * 0.8)
    x = (whir + hum) * (1 - (t >= dur - 0.15) * 0.5) + clunk * 1.2
    x[-int(0.05 * SR):] *= np.linspace(1, 0.4, int(0.05 * SR))
    x = _space(x, 0.5, 0.15, seed + 5)[:n]
    return _stereo(x, None, 0.3, seed), dur - 0.15


def static(dur: float = 0.55, seed: int = 9) -> tuple:
    """(sound, 0.0) — a burst of television static that dies away, for a cut into an old set or a quick montage."""
    n = int(dur * SR)
    t = np.linspace(0, 1, n)
    x = _band_noise(n, [3000, 5000, 4000, 2500], [2600, 3800, 3200, 2200], seed)
    x += 0.4 * _band_noise(n, [400, 700, 500], [300, 500, 400], seed + 1)
    env = np.where(t < 0.04, t / 0.04, np.exp(-(t - 0.04) * 4.2))
    return _stereo(x * env, None, 0.5, seed), 0.0


def typekey(seed: int = 21) -> tuple:
    """(sound, 0.0) — one typewriter key: a hard strike, a tiny metal ring."""
    n = int(0.09 * SR)
    t = np.arange(n) / SR
    x = _band_noise(n, [2200, 3800, 1200], [1500, 2200, 700], seed) * np.exp(-t * 210)
    x += np.sin(2 * np.pi * 3600 * t) * np.exp(-t * 160) * 0.2
    x[: int(0.001 * SR)] *= np.linspace(0, 1, int(0.001 * SR))
    return _stereo(x, None, 0.08, seed), 0.0


def boing(dur: float = 0.55, seed: int = 22) -> tuple:
    """(sound, 0.0) — a cartoon spring: a pitch that drops and wobbles."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = 520 * np.exp(-t * 3.2) * (1 + 0.18 * np.sin(2 * np.pi * 9 * t))
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 5.5)
    x += np.sin(2 * np.pi * np.cumsum(f * 2.01) / SR) * np.exp(-t * 9) * 0.3
    x[: int(0.004 * SR)] *= np.linspace(0, 1, int(0.004 * SR))
    return _stereo(x, None, 0.15, seed), 0.0


def ping(dur: float = 1.6, seed: int = 23) -> tuple:
    """(sound, 0.0) — a sonar ping: a clean high tone with a long tail in a big space."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    x = np.sin(2 * np.pi * 1180 * t) * np.exp(-t * 3.4) + np.sin(2 * np.pi * 2360 * t) * np.exp(-t * 6) * 0.25
    x[: int(0.003 * SR)] *= np.linspace(0, 1, int(0.003 * SR))
    x = _space(x, 1.4, 0.45, seed)[:n]
    return _stereo(x, None, 0.6, seed), 0.0


def sting(dur: float = 1.3, seed: int = 24) -> tuple:
    """(sound, 0.0) — a news sting: two quick struck notes and a short swell."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    a = np.sin(2 * np.pi * 440 * t) * np.exp(-t * 7) * (t < 0.6)
    t2 = np.clip(t - 0.16, 0, None)
    b = np.sin(2 * np.pi * 660 * t2) * np.exp(-t2 * 6) * (t >= 0.16)
    swell = _band_noise(n, [900, 1800, 2600], [500, 900, 1400], seed) * np.clip(t / 0.5, 0, 1) ** 2 * np.exp(-np.clip(t - 0.5, 0, None) * 5) * 0.35
    x = a + b * 0.9 + swell
    x = _space(x, 0.9, 0.25, seed)[:n]
    return _stereo(x, None, 0.4, seed), 0.0


def cash(dur: float = 0.7, seed: int = 25) -> tuple:
    """(sound, 0.0) — a cash register: a bright metallic clink and a little bell."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    clink = _band_noise(n, [4200, 6500, 3000], [2200, 3000, 1500], seed) * np.exp(-t * 60)
    bell = (np.sin(2 * np.pi * 2093 * t) + 0.6 * np.sin(2 * np.pi * 3136 * t) + 0.3 * np.sin(2 * np.pi * 4186 * t)) * np.exp(-t * 6) * 0.35
    x = clink + bell
    x[: int(0.002 * SR)] *= np.linspace(0, 1, int(0.002 * SR))
    x = _space(x, 0.5, 0.15, seed)[:n]
    return _stereo(x, None, 0.3, seed), 0.0


def pop(seed: int = 26) -> tuple:
    """(sound, 0.0) — a soft UI pop for something appearing."""
    n = int(0.18 * SR)
    t = np.arange(n) / SR
    f = 620 * np.exp(-t * 18) + 180
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 26)
    x += _band_noise(n, [1500, 900], [900, 500], seed) * np.exp(-t * 90) * 0.3
    x[: int(0.002 * SR)] *= np.linspace(0, 1, int(0.002 * SR))
    return _stereo(x, None, 0.1, seed), 0.0


def hum(dur: float = 2.6, seed: int = 27) -> tuple:
    """(sound, 0.0) — a low machine hum that swells and fades, under a cutaway or a map room."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    k = t / dur
    x = (np.sin(2 * np.pi * 55 * t) + 0.5 * np.sin(2 * np.pi * 110.5 * t) + 0.25 * np.sin(2 * np.pi * 164 * t)) * 0.5
    x += _band_noise(n, [120, 240, 400], [60, 120, 200], seed) * 0.35
    env = np.sin(np.pi * k) ** 1.4
    return _stereo(x * env, None, 0.5, seed), 0.0


# ── a drum machine's own voices (the ANALOG kit's 16-step pattern plays them) ────────────────────────────────
# Synthesised the way the TR-808's circuits make them — a pitch-swept sine for the kick, six square oscillators at
# the cymbal's metallic frequencies for the hats, two squares for the cowbell — so nothing here is a recording.
_METAL = (205.3, 304.4, 369.6, 522.7, 540.0, 800.0)


def _squares(freqs, n: int) -> np.ndarray:
    t = np.arange(n) / SR
    return sum(np.sign(np.sin(2 * np.pi * f * t + i)) for i, f in enumerate(freqs)) / len(freqs)


def _hp(x: np.ndarray, times: int = 2) -> np.ndarray:
    for _ in range(times):
        x = np.concatenate([[0.0], np.diff(x)])
    return x / (np.abs(x).max() + 1e-9)


def bd808(seed: int = 21, decay: float = 0.55) -> tuple:
    """(sound, 0.0) — the long, pitch-dropping sine boom."""
    n = int(1.3 * SR)
    t = np.arange(n) / SR
    f = 47 + 95 * np.exp(-t * 26)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / decay)
    x += _band_noise(n, [3000, 1500], [2000, 900], seed) * np.exp(-t * 500) * 0.2
    x = np.tanh(1.5 * x)
    return _stereo(x, None, 0.0, seed), 0.0


def sd808(seed: int = 22) -> tuple:
    n = int(0.36 * SR)
    t = np.arange(n) / SR
    tone = (np.sin(2 * np.pi * 185 * t) * 0.6 + np.sin(2 * np.pi * 332 * t) * 0.35) * np.exp(-t * 20)
    snap = _hp(_band_noise(n, [5200, 3000, 7000], [2600, 1500, 3000], seed), 1) * np.exp(-t * 15) * 0.8
    return _stereo(np.tanh(1.2 * (tone + snap)), None, 0.1, seed), 0.0


def cp808(seed: int = 23) -> tuple:
    n = int(0.42 * SR)
    t = np.arange(n) / SR
    noise = _band_noise(n, [1150, 950, 1450], [500, 400, 600], seed)
    env = sum(np.where(t >= ti, np.exp(-(t - ti) * 260), 0.0) for ti in (0.0, 0.011, 0.022))
    env = env * 0.8 + np.where(t >= 0.03, np.exp(-(t - 0.03) * 13), 0.0)
    return _stereo(noise * env, None, 0.35, seed), 0.0


def ch808(seed: int = 24, decay: float = 55.0, dur: float = 0.14) -> tuple:
    n = int(dur * SR)
    t = np.arange(n) / SR
    x = _hp(_squares(_METAL, n) * 0.6 + _band_noise(n, [8000], [3000], seed) * 0.25, 3) * np.exp(-t * decay)
    return _stereo(x, None, 0.2, seed), 0.0


def oh808(seed: int = 25) -> tuple:
    return ch808(seed, decay=6.5, dur=0.7)


def cb808(seed: int = 26) -> tuple:
    n = int(0.45 * SR)
    t = np.arange(n) / SR
    x = _squares((540.0, 800.0), n)
    x = _hp(x, 1) * 0.5 + x * 0.5
    x *= np.exp(-t * 28) * 0.6 + np.exp(-t * 6.5) * 0.4
    return _stereo(x, None, 0.1, seed), 0.0


def rs808(seed: int = 27) -> tuple:
    n = int(0.08 * SR)
    t = np.arange(n) / SR
    x = (np.sin(2 * np.pi * 1700 * t) * 0.7 + np.sin(2 * np.pi * 480 * t) * 0.5) * np.exp(-t * 90)
    return _stereo(x, None, 0.1, seed), 0.0


def tom808(seed: int = 28) -> tuple:
    n = int(0.6 * SR)
    t = np.arange(n) / SR
    f = 110 + 60 * np.exp(-t * 20)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 7) + _band_noise(n, [900], [500], seed) * np.exp(-t * 160) * 0.15
    return _stereo(x, None, 0.1, seed), 0.0


def kickac(seed: int = 29) -> tuple:
    """(sound, 0.0) — an acoustic kick drum for comparison: a short thud with the beater's click and a little room."""
    n = int(0.6 * SR)
    t = np.arange(n) / SR
    f = 58 + 70 * np.exp(-t * 45)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 16)
    x += _band_noise(n, [3200, 1800], [1800, 900], seed) * np.exp(-t * 170) * 0.45
    x = _space(x, 0.35, 0.18, seed)[:n]
    return _stereo(x, None, 0.25, seed), 0.0


def crackle(dur: float = 1.8, seed: int = 30) -> tuple:
    """(sound, 0.0) — a needle in the groove: sparse pops over a faint hiss."""
    n = int(dur * SR)
    rng = np.random.default_rng(seed)
    x = _band_noise(n, [4200, 6500], [1800, 2500], seed) * 0.06
    for at in rng.integers(0, n - 400, int(dur * 38)):
        k = np.arange(300)
        x[at:at + 300] += rng.uniform(-1, 1) * np.exp(-k / rng.uniform(8, 40)) * rng.uniform(0.2, 0.9)
    x *= np.minimum(1.0, np.arange(n) / (0.15 * SR)) * np.minimum(1.0, (n - np.arange(n)) / (0.3 * SR))
    return _stereo(x, None, 0.4, seed), 0.0


BANK = {"whoosh": whoosh, "hit": hit, "riser": riser, "tap": tap, "paper": paper,
        "shutter": shutter, "click": click, "tape": tape, "static": static,
        "typekey": typekey, "boing": boing, "ping": ping, "sting": sting, "cash": cash, "pop": pop, "hum": hum,
        "bd808": bd808, "sd808": sd808, "cp808": cp808, "ch808": ch808, "oh808": oh808, "cb808": cb808, "rs808": rs808,
        "tom808": tom808, "kickac": kickac, "crackle": crackle}
SFX_DIR = HERE / "assets" / "sfx"


def file_sounds(name: str) -> list:
    """Every real recording for a cue name — assets/sfx/<name>*.mp3|wav and the same in assets/sfx/*/ (the Epidemic
    pack lives in assets/sfx/es: shutter_02, shutter_canon, whoosh_short, crowd_cheer, hit_clean…) — as
    [(stereo float32, key second)], in name order. Empty when the channel ships none."""
    files = []
    for d in [SFX_DIR] + sorted(x for x in SFX_DIR.iterdir() if x.is_dir()) if SFX_DIR.is_dir() else []:
        files += sorted(f for f in d.iterdir() if f.is_file() and f.suffix.lower() in (".mp3", ".wav", ".m4a", ".ogg", ".flac")
                        and (f.stem.lower() == name or f.stem.lower().startswith(name + "_")))
    out = []
    for f in files:
        got = _load_sound(f, name)
        if got is not None:
            out.append(got)
    return out


def file_sound(name: str) -> tuple:
    """(stereo float32, key second) — a real recording from assets/sfx/<name>.mp3|wav (a cinematic hit, a riser),
    or None. A riser's key is its end (it lands on the mark); anything else starts on it."""
    for ext in (".mp3", ".wav", ".m4a", ".ogg", ".flac"):
        f = SFX_DIR / f"{name}{ext}"
        if f.is_file():
            return _load_sound(f, name)
    return None


def _load_sound(f: Path, name: str) -> tuple:
    if True:
        if f.is_file():
            p = subprocess.run(["ffmpeg", "-v", "error", "-i", str(f), "-t", "16", "-f", "f32le", "-ac", "2", "-ar", str(SR), "-"],
                               capture_output=True)
            x = np.frombuffer(p.stdout[: len(p.stdout) // 8 * 8], np.float32).reshape(-1, 2).copy()
            if len(x) < SR // 20:
                return None
            x /= (np.abs(x).max() + 1e-9)
            k = min(len(x), int(0.01 * SR))
            x[-k:] *= np.linspace(1, 0, k)[:, None]
            # a riser ends where it should land: its key is the last loud moment
            if "riser" in name:
                loud = np.where(np.abs(x).max(axis=1) > 0.35)[0]
                return x, (float(loud[-1]) / SR if len(loud) else len(x) / SR)
            return x, 0.0
    return None


# ── what plays where ───────────────────────────────────────────────────────────
def cues(plan: list) -> list:
    """[(second the sound's key moment lands on, sound, gain dB)] for a finished timeline."""
    out, t = [(0.0, "hit", -1.0)], 0.0
    for kind, path, _leak, dur in plan:
        dur = float(dur)
        name = Path(str(path)).name
        stem = Path(str(path)).stem
        if kind == "motion":
            marks = Path(str(path)).with_suffix(".sfx.json")
            own = None
            if marks.exists():
                try:        # the scene knows its own timing (docgfx.sound_marks, a Kodak strip's clicks, a newspaper)
                    own = [(t + float(a), str(s_), float(g)) for a, s_, g in json.loads(marks.read_text(encoding="utf-8"))]
                except (OSError, ValueError, TypeError):
                    own = None
            if name.startswith("doc_"):
                out += own if own is not None else [(t, "whoosh", -3.0)]
                out.append((t + dur, "whoosh_out", -9.0))
            elif own is not None:
                out += own
            elif name.startswith("chapter_"):
                out += [(t, "tape", -7.0), (t + 0.4, "hit", -4.0)]
            elif name.startswith("strip_"):
                out += [(t, "shutter", -3.0)]
            elif name.startswith("press_"):
                out += [(t, "paper", -3.0), (t + 1.3, "hit", -11.0)]
            elif name.startswith(("bite_", "montage")):
                out += [(t, "static", -9.0)]
            elif name.startswith("map_"):
                out += [(t, "whoosh", -3.0), (t + 1.1, "hit", -10.0), (t + dur, "whoosh_out", -10.0)]
            elif name.startswith("headline_"):
                out += [(t, "paper", -3.0), (t + 1.4, "hit", -12.0)]
            elif name.startswith(("spot_", "objects_", "depth_")):
                out += [(t, "whoosh", -5.0)]
            elif stem.startswith(("vox", "scene_vox")) or "/vox/" in str(path):
                out += [(t, "paper", -4.0)]
            elif stem != "introcap":
                out += [(t, "whoosh", -4.0)]
        t += dur
    return sorted(out)


# ── the mix ───────────────────────────────────────────────────────────────────
def _vary(names: list, key: str, job: Path, log=None) -> str:
    """Which of several tracks a style names to use for this video: the one this channel has gone without for
    longest, so two videos in a row do not open on the same music. The choices are remembered next to the
    output folder (and in ~/.frontier/), and a re-render of the same job keeps the track it already had."""
    names = [str(n).strip() for n in names if str(n).strip()]
    if len(names) < 2:
        return names[0] if names else ""
    stores = [job.parent / "_music_used.json", Path.home() / ".frontier" / "music_used.json"]
    hist = {}
    for f in stores:
        try:
            got = json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            continue
        for k, v in got.items():
            if len(str(v)) > len(str(hist.get(k, ""))):
                hist[k] = v
    jobs = hist.get("_jobs") or {}
    had = str((jobs.get(job.name) or {}).get(key) or "")
    low = {n.lower(): n for n in names}
    if had.lower() in low:
        return low[had.lower()]
    used = [str(x) for x in (hist.get(key) or []) if str(x).strip()]
    seen = {n.lower(): i for i, n in enumerate(reversed(used))}     # 0 = the one used last
    pick = max(names, key=lambda n: (seen.get(n.lower(), 10 ** 6), -names.index(n)))
    hist[key] = (used + [pick])[-14:]
    jobs.setdefault(job.name, {})[key] = pick
    hist["_jobs"] = {k: v for k, v in list(jobs.items())[-60:]}
    for f in stores:
        try:
            f.parent.mkdir(parents=True, exist_ok=True)
            f.write_text(json.dumps(hist, ensure_ascii=False, indent=1), encoding="utf-8")
        except Exception:
            pass
    if log and seen:
        log(f"music: '{pick}' this time — last video ran on '{used[-1]}'")
    return pick


def _tracks(style: str) -> list:
    """The channel's tracks: assets/music/<style>/ and its mood folders (dramatic first, when there is one), else
    whatever lies straight under assets/music/."""
    d = MUSIC / style
    if d.is_dir():
        ok = lambda p: p.is_file() and p.suffix.lower() in (".mp3", ".wav", ".m4a", ".ogg", ".flac")
        got = sorted(p for p in d.iterdir() if ok(p))
        if not got:
            moods = sorted((x for x in d.iterdir() if x.is_dir()), key=lambda x: (x.name.lower() != "dramatic", x.name))
            for m in moods:
                got += sorted(p for p in m.iterdir() if ok(p))
        if got:
            return got
    if MUSIC.is_dir():
        got = sorted(p for p in MUSIC.iterdir() if p.is_file() and p.suffix.lower() in (".mp3", ".wav", ".m4a", ".ogg", ".flac"))
        if got:
            return got
    return []


def _pcm(path: Path, channels: int, loops: int = 0):
    cmd = ["ffmpeg", "-v", "error"] + (["-stream_loop", str(loops)] if loops else []) + \
          ["-i", str(path), "-f", "f32le", "-ac", str(channels), "-ar", str(SR), "-"]
    return subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)


def _duration(path: Path) -> float:
    p = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
                       capture_output=True, text=True)
    try:
        return float(p.stdout.strip() or 0)
    except ValueError:
        return 0.0



def _bed(job: Path, intro: Path, names: list, total: float, intro_s: float, body_db: float, log):
    """One music file for the whole video: the intro track for the opening, then the body tracks one after
    another (looped as needed), crossfaded, the body lower by body_db against the intro. None when it cannot be made."""
    found = []
    for n in names:
        want = n.lower()
        hit = sorted(p for p in MUSIC.rglob("*") if p.is_file() and p.suffix.lower() in (".mp3", ".wav", ".m4a", ".ogg", ".flac")
                     and (p.stem.lower() == want or p.name.lower() == want))
        if hit:
            found.append(hit[0])
    if not found:
        return None
    out = job / "_music_bed.wav"
    seq, have = [], intro_s + 8.0
    while have < total + 10 and len(seq) < 40:
        p = found[len(seq) % len(found)]
        seq.append(p)
        have += max(10.0, _duration(p) - 6.0)
    ins = ["-i", str(intro)]
    for p in seq:
        ins += ["-i", str(p)]
    g = 10 ** (body_db / 20.0)
    fc = [f"[0:a]atrim=0:{intro_s + 8.0:.2f},aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[a0]"]
    for i in range(len(seq)):
        fc.append(f"[{i + 1}:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,volume={g:.4f}[b{i}]")
    cur = "a0"
    for i in range(len(seq)):
        nxt = f"x{i}"
        fc.append(f"[{cur}][b{i}]acrossfade=d={8.0 if i == 0 else 6.0}:c1=tri:c2=tri[{nxt}]")
        cur = nxt
    fc.append(f"[{cur}]atrim=0:{total + 2:.2f}[out]")
    try:
        subprocess.run(["ffmpeg", "-y", "-v", "error"] + ins + ["-filter_complex", ";".join(fc), "-map", "[out]",
                        "-c:a", "pcm_s16le", str(out)], check=True, capture_output=True, timeout=900)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as e:
        log(f"sound: body music not joined — {str(e)[:100]}")
        return None
    log(f"sound: '{intro.stem}' opens, then " + ", ".join(f"'{p.stem}'" for p in dict.fromkeys(seq)) + f" at {body_db:+.0f} dB")
    return out

def _inserts(job: Path, log) -> list:
    """[(sample, stereo float32)] — the interview clips and the name montage soundbites.py cut into the video
    (job/soundbites.json: t, dur, wav), decoded once; each plays where its picture is."""
    f = job / "soundbites.json"
    if not f.exists():
        return []
    try:
        rows = json.loads(f.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    out = []
    for r in rows if isinstance(rows, list) else []:
        wav = Path(str(r.get("wav") or ""))
        if not wav.is_file():
            continue
        p = subprocess.run(["ffmpeg", "-v", "error", "-i", str(wav), "-t", f"{float(r.get('dur') or 0) + 0.05:.3f}",
                            "-f", "f32le", "-ac", "2", "-ar", str(SR), "-"], capture_output=True)
        x = np.frombuffer(p.stdout[: len(p.stdout) // 8 * 8], np.float32).reshape(-1, 2).copy()
        if len(x) < SR // 10:
            continue
        try:
            x *= 10 ** (float(r.get("gain_db") or 0.0) / 20)   # a sound-up sits a touch under an interview
        except (TypeError, ValueError):
            pass
        # a short fade either side so the cut never clicks
        k = min(len(x) // 2, int(0.03 * SR))
        x[:k] *= np.linspace(0, 1, k)[:, None]
        x[-k:] *= np.linspace(1, 0, k)[:, None]
        out.append((int(round(float(r.get("t") or 0) * SR)), x))
    if out:
        log(f"sound: {len(out)} interview clip(s) play with their own sound")
    return out


def _mood_tracks(style: str, mood: str) -> list:
    d = MUSIC / style / mood
    if not d.is_dir():
        return []
    return sorted(p for p in d.iterdir() if p.is_file() and p.suffix.lower() in (".mp3", ".wav", ".m4a", ".ogg", ".flac"))


def _bed_moods(job: Path, style: str, total: float, look: dict, log):
    """One music file for the whole video that follows the chapters' moods (look.sound.moods, chapters.json
    "mood": dramatic / inspiring / quiet from the script's "## Title | mood" lines): each chapter's stretch
    gets a track from assets/music/<style>/<mood>/, crossfaded at the chapter card. None when the channel
    has no moods, no chapters or no mood folders."""
    if not (look.get("sound") or {}).get("moods"):
        return None
    try:
        chapters = [c for c in json.loads((job / "chapters.json").read_text(encoding="utf-8")) if c.get("t") is not None]
    except (OSError, ValueError):
        chapters = []
    moods = [str(c.get("mood") or "").lower() for c in chapters]
    moods = [m for m in moods if m]
    if not moods:
        # no chapters to follow: the dramatic shelf, never a random mood
        got = _mood_tracks(style, "dramatic")
        if got:
            pick = got[zlib.crc32(job.name.encode("utf-8")) % len(got)]
            log(f"sound: no chapter moods — dramatic music the whole way ('{pick.stem}')")
            return pick
        return None
    seq = []                                       # (start, end, mood)
    snd = look.get("sound") or {}
    first = str(chapters[0].get("mood") or "dramatic").lower()
    # the cold open, before the first chapter card, is its own stretch: look.sound.opening names its mood
    # (courtside: always dramatic), else it takes the first chapter's
    opening = str(snd.get("opening") or first).lower()
    events = [(float(c["t"]), str(c.get("mood") or first).lower()) for c in chapters if float(c["t"]) > 3.0]
    try:                                            # the script's "[[mood: …]]" turns, placed on the voice
        events += [(float(x["t"]), str(x["mood"]).lower()) for x in json.loads((job / "moods.json").read_text(encoding="utf-8"))
                   if float(x.get("t") or 0) > 3.0 and str(x.get("mood") or "").strip()]
    except (OSError, ValueError, KeyError, TypeError):
        pass
    events.sort(key=lambda e: e[0])
    starts = [0.0] + [t for t, _ in events]
    names = [opening] + [m for _, m in events]
    # look.sound.lead_tracks = {"dramatic": "dramatic documentary", "inspiring": "winning documentary"}: the
    # track that opens a shelf the first time the video reaches that mood; the shelf's other tracks follow
    lead = {str(k).lower(): str(v).lower() for k, v in (snd.get("lead_tracks") or {}).items()}
    # look.sound.chapter_turn = "stop": every chapter gets its own cue, even when the mood stays the same
    stop = str(snd.get("chapter_turn") or "").lower() == "stop"
    for i, (a, m) in enumerate(zip(starts, names)):
        b = starts[i + 1] if i + 1 < len(starts) else total + 2.0
        if seq and seq[-1][2] == m and not stop:
            seq[-1] = (seq[-1][0], b, m)
        else:
            seq.append((a, b, m))
    used, picks, last = {}, [], None
    for a, b, m in seq:
        shelf = m if _mood_tracks(style, m) else ("quiet" if m == "quiet" and _mood_tracks(style, "quiet") else "dramatic")
        got = _mood_tracks(style, shelf) or _tracks(style)
        if not got:
            return None
        k = used.get(shelf, 0)
        if lead.get(shelf):
            got = sorted(got, key=lambda p: (lead[shelf] not in p.stem.lower(), p.stem.lower()))
            off = 0                                  # the lead track first, then the shelf in order
        else:
            off = zlib.crc32(job.name.encode("utf-8"))
        pick = got[(k + off) % len(got)]
        if pick == last and len(got) > 1:            # never the same track twice in a row
            k += 1
            pick = got[(k + off) % len(got)]
        picks.append((a, b, m, pick))
        used[shelf] = k + 1
        last = pick
    if len(picks) == 1:
        log(f"sound: music follows the chapters — {picks[0][2]} the whole way ('{picks[0][3].stem}')")
        return picks[0][3]                         # one mood the whole way: that mood's own track
    if stop:
        stopped = _bed_stops(job, picks, chapters, total, snd, log)
        if stopped:
            return stopped
    out = job / "_music_moods.wav"
    xf = 5.0
    ins, fc = [], []
    for i, (a, b, m, p) in enumerate(picks):
        need = (b - a) + xf + 1.0
        loops = int(need // max(1.0, _duration(p) - 1.0)) + 1
        ins += ["-stream_loop", str(loops), "-i", str(p)]
        # every track brought to one loudness first: the bed's gain is set once against the voice, and a
        # quiet dramatic cue followed by a full piano piece made the second track play too loud
        fc.append(f"[{i}:a]loudnorm=I=-20:TP=-2:LRA=7,aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,"
                  f"atrim=0:{need:.2f},asetpts=PTS-STARTPTS[s{i}]")
    cur = "s0"
    for i in range(1, len(picks)):
        fc.append(f"[{cur}][s{i}]acrossfade=d={xf:.1f}:c1=tri:c2=tri[x{i}]")
        cur = f"x{i}"
    fc.append(f"[{cur}]atrim=0:{total + 2:.2f}[out]")
    try:
        subprocess.run(["ffmpeg", "-y", "-v", "error"] + ins + ["-filter_complex", ";".join(fc), "-map", "[out]",
                        "-c:a", "pcm_s16le", str(out)], check=True, capture_output=True, timeout=900)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as e:
        log(f"sound: mood music not joined — {str(e)[:100]}")
        return None
    log("sound: music follows the chapters — " + ", ".join(f"{m} ('{p.stem}') from {int(a) // 60}:{int(a) % 60:02d}"
                                                             for a, b, m, p in picks))
    return out


def _bed_stops(job: Path, picks: list, chapters: list, total: float, snd: dict, log):
    """look.sound.chapter_turn = "stop" (STRATA; measured on its reference, a 1.2-3 s silence at every chapter turn):
    the running track ends with the paragraph (a short fade on its tail), the chapter pause stays silent, and the next
    track starts from its top under the new picture, `stop_lead_s` before the narrator returns. A mood turn with no
    pause (a "[[mood: x]]" inside a chapter) gets a short gap instead. None when ffmpeg fails (the caller then
    crossfades as before)."""
    pauses = {round(float(c["t"]), 2): float(c.get("pause") or 0.0) for c in chapters if c.get("t") is not None}
    tail = float(snd.get("stop_tail_s", 0.35))       # the last sentence decays this long after the pause starts
    fade = float(snd.get("stop_fade_s", 0.6))
    lead = float(snd.get("stop_lead_s", 0.8))        # the next cue starts this long before the voice returns
    segs, start = [], 0.0                             # (start, end, track)
    for i, (a, b, m, p) in enumerate(picks):
        if i + 1 < len(picks):
            t = float(picks[i + 1][0])
            pz = pauses.get(round(t, 2), 0.0)
            end = t + tail
            nxt = max(end + 0.4, t + pz - lead)
        else:
            end = nxt = total + 2.0
        segs.append((start, end, p))
        start = nxt
    out = job / "_music_moods.wav"
    ins, fc = [], []
    for i, (s0, e0, p) in enumerate(segs):
        seg_len = max(0.5, e0 - s0)
        loops = int(seg_len // max(1.0, _duration(p) - 1.0)) + 1
        ins += ["-stream_loop", str(loops), "-i", str(p)]
        fo = min(fade, seg_len / 2)
        chain = (f"[{i}:a]loudnorm=I=-20:TP=-2:LRA=7,aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,"
                 f"atrim=0:{seg_len:.3f},asetpts=PTS-STARTPTS")
        if i > 0:
            chain += ",afade=t=in:st=0:d=0.04"
        if i + 1 < len(segs):
            chain += f",afade=t=out:st={seg_len - fo:.3f}:d={fo:.3f}"
        ms = int(round(s0 * 1000))
        fc.append(chain + f",adelay={ms}|{ms}[s{i}]")
    fc.append("".join(f"[s{i}]" for i in range(len(segs)))
              + f"amix=inputs={len(segs)}:duration=longest:normalize=0,atrim=0:{total + 2:.2f}[out]")
    try:
        subprocess.run(["ffmpeg", "-y", "-v", "error"] + ins + ["-filter_complex", ";".join(fc), "-map", "[out]",
                        "-c:a", "pcm_s16le", str(out)], check=True, capture_output=True, timeout=900)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as e:
        log(f"sound: chapter stops not made — {str(e)[:100]}")
        return None
    log("sound: music stops at every chapter turn — " + ", ".join(
        f"'{p.stem}' {int(s0) // 60}:{int(s0) % 60:02d}-{int(e0) // 60}:{int(e0) % 60:02d}" for s0, e0, p in segs))
    return out


def mix(engine, job: Path, voice: Path, plan: list, style: str) -> Path:
    """The narration with the sound design (and any music) under it, as job/_voice_sound.wav."""
    look = ((engine.STYLE_INFO.get(style) or {}).get("look") or {}) if engine is not None else {}
    cfg = dict(DEFAULTS)
    cfg.update({k: v for k, v in (look.get("sound") or {}).items() if k in DEFAULTS})
    out = job / "_voice_sound.wav"
    total = _duration(voice)
    if total <= 0:
        return voice
    log = engine.log if engine is not None else print
    sounds = {}
    variants = {"whoosh": 4, "hit": 3, "riser": 2, "tap": 3, "paper": 3, "shutter": 3, "click": 3, "tape": 2, "static": 3,
                "typekey": 4, "boing": 2, "ping": 2, "sting": 2, "cash": 2, "pop": 3, "hum": 2}
    for name, fn in BANK.items():
        sounds[name] = [fn(seed=11 + 17 * k) for k in range(variants.get(name, 1))]
    sounds["whoosh_out"] = [whoosh(dur=0.9, seed=301 + 17 * k, up=False) for k in range(3)]
    for name in ("hit", "riser", "crowd", "whoosh", "shutter", "click"):   # the real recordings, when the channel ships them
        real = file_sounds(name)
        if real:
            sounds[f"{name}_file"] = real
            if name in ("shutter", "whoosh", "crowd"):   # a real shutter or crowd beats the synthesised one outright
                sounds[name] = real
    # this video's own sound design (epidemic_sound.py): a fresh kit in job/sound/sfx/ replaces both the synthesised
    # sounds and the stock recordings for every cue it covers
    try:
        import epidemic_sound
        own = {}
        for role, files in epidemic_sound.job_sounds(job).items():
            bank = [got for got in (_load_sound(f, role) for f in files) if got is not None]
            if bank:
                own[role] = bank
        for role, bank in own.items():
            sounds[role] = bank
            sounds[f"{role}_file"] = bank
        if own:
            log(f"sound: this video's own effects for {', '.join(sorted(own))}")
    except Exception as e:                                             # noqa: BLE001 - the stock sounds stay
        log(f"sound: own effects not used — {str(e)[:100]}")
    events = []
    for i, (at, name, gain) in enumerate(cues(plan)):
        bank = sounds.get(name)
        if not bank and str(name).startswith("file:"):
            # a mark may name one recording directly, e.g. "file:sfx/es/strata/montage_tick_1.wav": a kit's own sound,
            # scoped to it (the cue banks above are shared by every channel); silent where the file is not installed
            f = SFX_DIR.parent / str(name)[5:]
            got = _load_sound(f, f.stem.lower()) if f.is_file() else None
            bank = sounds[name] = [got] if got else []
        if not bank:
            continue
        snd, key = bank[i % len(bank)]
        start = int(round((at - key) * SR))
        if start + len(snd) <= 0 or start >= total * SR:
            continue
        events.append((start, snd, _db(cfg["sfx_db"] + gain)))
    # interview clips and the name montage (soundbites.py) play their own sound where the narration pauses:
    # mixed in at full level, and the music ducks under them as it does under the voice
    inserts = _inserts(job, log)
    for start, snd in inserts:
        events.append((start, snd, 1.0))
    tracks = _tracks(style) if cfg.get("music") else []
    mood_bed = _bed_moods(job, style, total, look, log) if cfg.get("music") else None
    own_bed = None
    if cfg.get("music"):
        try:
            import epidemic_sound
            own_bed = epidemic_sound.ensure_music(job, look, total, log)
        except Exception as e:                                         # noqa: BLE001 - the channel's music stays
            log(f"sound: own music not used — {str(e)[:100]}")
    if own_bed is not None:
        mood_bed = own_bed
    if mood_bed is not None:
        tracks = [mood_bed]
    # one track asked for by name: FRONTIER_MUSIC in the environment, or look.sound.track in the style —
    # looked for in the channel's folder first, then anywhere under assets/music/
    asked = os.environ.get("FRONTIER_MUSIC") or (look.get("sound") or {}).get("track") or ""
    pool = [x for x in (asked if isinstance(asked, (list, tuple)) else re.split(r"\s*\|\s*", str(asked))) if str(x).strip()]
    want = _vary(pool, f"{style}:intro", job, log).strip().lower()
    named = []
    if mood_bed is not None:
        want, named = "", [mood_bed]
    if want and cfg.get("music"):
        # A style may name its track with the folder it lives in ("gta/good for gta.mp3") —
        # nine of them do. Comparing the file name alone never matched that, and with nothing
        # lying straight under assets/music/ those styles rendered with no music at all.
        def match(t):
            try:
                rel = t.relative_to(MUSIC).as_posix().lower()
            except ValueError:
                rel = ""
            return want in (t.name.lower(), t.stem.lower(), rel, rel.rsplit(".", 1)[0])
        named = [t for t in tracks if match(t)] or sorted(
            t for t in MUSIC.rglob("*") if t.is_file() and t.suffix.lower() in (".mp3", ".wav", ".m4a", ".ogg", ".flac")
            and match(t)) if MUSIC.is_dir() else []
        tracks = tracks or named
    music, mdb = None, None
    body = [str(x) for x in ((look.get("sound") or {}).get("body_tracks") or []) if str(x).strip()]
    if own_bed is not None:
        body = []                   # the video's own bed already changes music chapter by chapter
    if len(body) > 1:
        # the body music turns over too, and never starts on the track the opening just played
        body = [b for b in body if b.strip().lower() != want] or body
        k = body.index(_vary(body, f"{style}:body", job, log))
        body = body[k:] + body[:k]
    if tracks and body and float(cfg["intro_s"] or 0) > 0:
        # the opening keeps its own track; after it the film runs on other music (look.sound.body_tracks)
        bed = _bed(job, named[0] if named else tracks[0], body, total, float(cfg["intro_s"]),
                   float((look.get("sound") or {}).get("body_db") or -8.0), log)
        if bed is not None:
            named, tracks = [bed], [bed]      # the bed is levelled like any track; intro_db / after_db still shape it
    if tracks:
        pick = named[0] if named else tracks[zlib.crc32(job.name.encode("utf-8")) % len(tracks)]
        loops = int(total // max(1.0, _duration(pick)))
        music = _pcm(pick, 2, loops)
        vdb, mdb = _active_db(voice, total + 1), _active_db(pick, min(total, _duration(pick)) + 1, channels=2)
        if vdb is not None and mdb is not None:
            cfg["music_db"] = max(-40.0, min(0.0, vdb + float(cfg["music_rel_db"]) - mdb))
        log(f"sound: {len(events)} effects + music bed '{pick.name}' under the voice"
            + (f" ({cfg['music_db']:+.1f} dB: {cfg['music_rel_db']:+.0f} dB against the voice)" if vdb is not None and mdb is not None else "")
            + (f", {float(cfg['intro_db']):+.0f} dB for the first {float(cfg['intro_s']):.0f} s, then "
               + ("off" if str(cfg["after_db"]).lower() == "off" else f"{float(cfg['after_db']):+.0f} dB")
               if float(cfg["intro_s"] or 0) > 0 else ""))
    else:
        log(f"sound: {len(events)} effects under the voice (no music in assets/music/)")
    vproc = _pcm(voice, 1)
    chunk = SR * 5
    duck_gain, env_state, level_gain = 1.0, 0.0, 1.0
    fade_in, fade_out = (0.8 if inserts else 2.5) * SR, 4.0 * SR   # a montage opens on music already playing
    n_total = int(total * SR)
    pos = 0
    wav = wave.open(str(out), "wb")
    wav.setnchannels(2)
    wav.setsampwidth(2)
    wav.setframerate(SR)
    try:
        while True:
            raw = vproc.stdout.read(chunk * 4)
            if not raw:
                break
            v = np.frombuffer(raw[: len(raw) // 4 * 4], np.float32)
            n = len(v)
            buf = np.repeat(v[:, None], 2, 1).astype(np.float32)
            for start, snd, g in events:
                a, b = max(start, pos), min(start + len(snd), pos + n)
                if a < b:
                    buf[a - pos:b - pos] += snd[a - start:b - start] * g
            if inserts:
                # the clips' own speech counts as voice for the ducking below
                v = v.copy()
                for start, snd in inserts:
                    a, b = max(start, pos), min(start + len(snd), pos + n)
                    if a < b:
                        v[a - pos:b - pos] += snd[a - start:b - start].mean(axis=1)
            if music is not None:
                mraw = music.stdout.read(n * 8)
                m = np.frombuffer(mraw[: len(mraw) // 8 * 8], np.float32).reshape(-1, 2)
                if len(m) < n:
                    m = np.vstack([m, np.zeros((n - len(m), 2), np.float32)])
                # the voice's loudness, smoothed: fast down, slow back up
                blk = 480
                nb = int(math.ceil(n / blk))
                rms = np.sqrt(np.mean(np.pad(v, (0, nb * blk - n)).reshape(nb, blk) ** 2, axis=1))
                target = np.where(rms > 0.02, _db(cfg["duck_db"]), 1.0)
                gains = np.empty(nb)
                # a quiet passage of the track is lifted (at most +6 dB) and a loud one tamed, slowly, so the
                # bed stays at one level under the voice however the song was mastered
                mr = float(np.sqrt(np.mean(m[:n] ** 2)) + 1e-9)
                lift = min(2.0, max(0.5, (10 ** (mdb / 20) if mdb is not None else mr) / mr)) if mr > 1e-4 else 1.0
                for k in range(nb):
                    coef = 0.35 if target[k] < duck_gain else 0.08
                    duck_gain += (target[k] - duck_gain) * coef
                    gains[k] = duck_gain
                gain = np.repeat(gains, blk)[:n]
                idx = np.arange(pos, pos + n)
                fade = np.minimum(1.0, np.minimum(idx / fade_in, np.maximum(0.0, (n_total - idx) / fade_out)))
                ramp = np.linspace(level_gain, lift, n)
                level_gain = lift
                shape = 1.0
                if float(cfg["intro_s"] or 0) > 0:
                    after = 0.0 if str(cfg["after_db"]).lower() == "off" else _db(float(cfg["after_db"]))
                    x = np.clip((idx / SR - float(cfg["intro_s"])) / max(0.5, float(cfg["intro_fade_s"])), 0.0, 1.0)
                    shape = _db(float(cfg["intro_db"])) * (1.0 - x) + after * x
                buf += m[:n] * (gain * fade * ramp * shape * _db(cfg["music_db"]))[:, None]
            # a gentle ceiling instead of clipping
            over = np.abs(buf) > 0.92
            if over.any():
                buf[over] = np.sign(buf[over]) * (0.92 + 0.08 * np.tanh((np.abs(buf[over]) - 0.92) / 0.08))
            wav.writeframes((np.clip(buf, -1, 1) * 32767).astype("<i2").tobytes())
            pos += n
    finally:
        wav.close()
        for p in (vproc, music):
            if p is not None:
                p.stdout.close()
                p.kill()
    if pos <= 0:
        return voice
    return master(out, log)


def master(path: Path, log=print, target: float = -14.0) -> Path:
    """The finished soundtrack at YouTube's loudness (-14 LUFS, peaks under -1.5 dBTP): measured once, then
    turned up or down in one straight line, so nothing pumps. A quieter upload is simply played quieter."""
    import json as _json
    probe = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-af",
                            f"loudnorm=I={target}:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"],
                           capture_output=True, text=True)
    m = re.search(r"\{[^{}]*\"input_i\"[^{}]*\}", probe.stderr or "")
    if not m:
        return path
    try:
        got = _json.loads(m.group(0))
        flt = (f"loudnorm=I={target}:TP=-1.5:LRA=11:measured_I={got['input_i']}:measured_TP={got['input_tp']}:"
               f"measured_LRA={got['input_lra']}:measured_thresh={got['input_thresh']}:offset={got['target_offset']}:linear=true")
    except (ValueError, KeyError):
        return path
    tmp = path.with_name(path.stem + "_master.wav")
    run = subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(path), "-af", flt, "-ar", str(SR), "-ac", "2",
                          "-c:a", "pcm_s16le", str(tmp)], capture_output=True, text=True)
    if run.returncode != 0 or not tmp.exists():
        tmp.unlink(missing_ok=True)
        return path
    tmp.replace(path)
    log(f"sound: mastered from {float(got['input_i']):.1f} to {target:.0f} LUFS")
    return path


# ── preview ────────────────────────────────────────────────────────────────────
def _write(path: Path, x: np.ndarray) -> None:
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((np.clip(x, -1, 1) * 32767 * 0.8).astype("<i2").tobytes())


if __name__ == "__main__":
    if sys.argv[1:2] == ["preview"]:
        d = HERE / "preview" / "sfx"
        d.mkdir(parents=True, exist_ok=True)
        for name, fn in BANK.items():
            _write(d / f"{name}.wav", fn()[0])
        _write(d / "whoosh_out.wav", whoosh(dur=0.9, seed=301, up=False)[0])
        print(f"wrote {len(BANK) + 1} sounds to {d}")
    else:
        print(__doc__)
