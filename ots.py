#!/usr/bin/env python3
"""ots.py — the company's mark over the presenter's shoulder.

A news presenter is never alone in the frame: a box over the shoulder says what the
story is before a word of it lands. PULSE's presenter talks about one company at a time,
so each time he appears, the company he is talking about gets its official mark in a
dark glass panel above the bookshelf, sliding in a moment after the cut.

Which company: the subtitles spoken inside the presenter's window, and if they name none,
the next few seconds (he usually introduces what comes next). The first company named
wins; a window that names none gets no panel rather than a guess.

The panel sits top-left, over the bookshelf — the presenter's face is centred and the
microphone arm comes in from the right, so that corner is the only one that is empty in
every take of this set.

Style switch: look.avatar.logos = true.

    decorate(job, clips, srt, log)  -> the clips, each with its panel (or untouched)
"""
import re
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent

# the company, and the words that mean it in a narration (lower case, word-ish)
COMPANIES = [
    ("OpenAI", ("openai", "chatgpt", "gpt-6", "gpt-5", "gpt 6", "sora", "codex", "sam altman")),
    ("Anthropic", ("anthropic", "claude", "opus", "fable", "sonnet", "dario amodei")),
    ("Google Gemini", ("gemini", "google", "deepmind", "demis hassabis")),
    ("Alibaba", ("alibaba", "qwen", "damo")),
    ("Grok", ("xai", "grok", "elon musk")),
    ("Meta", ("meta ai", "llama", "zuckerberg")),
    ("Nvidia", ("nvidia", "jensen huang")),
    ("DeepSeek", ("deepseek",)),
    ("Mistral AI", ("mistral",)),
    ("Perplexity AI", ("perplexity",)),
    ("Microsoft", ("microsoft",)),
]

LOOK_AHEAD_S = 8.0


def _cues(srt: Path) -> list:
    out = []
    txt = Path(srt).read_text(encoding="utf-8", errors="ignore")
    for block in txt.strip().split("\n\n"):
        lines = block.strip().splitlines()
        if len(lines) >= 3 and "-->" in lines[1]:
            def ts(x):
                h, m, s = x.strip().replace(",", ".").split(":")
                return int(h) * 3600 + int(m) * 60 + float(s)
            a, b = (ts(x) for x in lines[1].split("-->"))
            out.append((a, b, " ".join(lines[2:])))
    return out


def company_for(cues: list, start: float, end: float):
    """The first company named in [start, end], else in the look-ahead after it."""
    for lo, hi in ((start, end), (end, end + LOOK_AHEAD_S)):
        text = " ".join(t for a, b, t in cues if a < hi and b > lo).lower()
        best = None
        for name, words in COMPANIES:
            for w in words:
                m = re.search(r"(?<![a-z0-9])" + re.escape(w) + r"(?![a-z0-9])", text)
                if m and (best is None or m.start() < best[0]):
                    best = (m.start(), name)
        if best:
            return best[1]
    return None


def _probe(p: Path):
    r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                        "stream=width,height", "-of", "csv=p=0", str(p)], capture_output=True, text=True)
    w, h = (int(x) for x in r.stdout.strip().split(",")[:2])
    return w, h


def _panel(company: str, w: int, h: int, dest: Path) -> bool:
    """The panel on a transparent canvas the size of the clip. False when the company
    has no usable mark — then the presenter gets no panel rather than a name in a box."""
    from PIL import Image, ImageDraw, ImageFilter
    import logos
    try:
        mark = logos.fetch(company, on="dark", log=lambda *_: None)
    except Exception:                                   # noqa: BLE001 - no mark, no panel
        mark = None
    if not mark or not Path(mark).exists():
        return False
    mark_im = Image.open(mark).convert("RGBA")
    k = w / 1280.0
    px, py, pw, ph, r = int(44 * k), int(64 * k), int(390 * k), int(176 * k), int(18 * k)
    canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    # a soft shadow under the glass, so it sits in front of the shelf instead of on it
    sh = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle([px, py + int(10 * k), px + pw, py + ph + int(10 * k)], r, fill=(0, 0, 0, 120))
    canvas = Image.alpha_composite(canvas, sh.filter(ImageFilter.GaussianBlur(int(18 * k))))
    d = ImageDraw.Draw(canvas)
    d.rounded_rectangle([px, py, px + pw, py + ph], r, fill=(13, 13, 13, 205), outline=(255, 255, 255, 36), width=max(1, int(1.5 * k)))
    # the lime rule down the left edge is interface furniture — the one job lime has in PULSE
    d.rounded_rectangle([px, py + int(22 * k), px + int(5 * k), py + ph - int(22 * k)], int(3 * k), fill=(190, 242, 66, 255))
    # the mark, fitted into the panel with room around it
    mw, mh = pw - int(84 * k), ph - int(70 * k)
    s = min(mw / mark_im.width, mh / mark_im.height)
    mark_im = mark_im.resize((max(1, int(mark_im.width * s)), max(1, int(mark_im.height * s))), Image.LANCZOS)
    canvas.alpha_composite(mark_im, (px + (pw - mark_im.width) // 2 + int(6 * k), py + (ph - mark_im.height) // 2))
    canvas.save(dest)
    return True


def _decorate_one(clip: Path, company: str, log=print) -> Path:
    slug = re.sub(r"[^a-z0-9]+", "-", company.lower()).strip("-")
    out = clip.with_name(f"{clip.stem}_ots_{slug}{clip.suffix}")
    if out.exists() and out.stat().st_mtime >= clip.stat().st_mtime:
        return out
    w, h = _probe(clip)
    png = clip.with_name(f"{clip.stem}_ots_{slug}.png")
    if not _panel(company, w, h, png):
        return clip
    # slides in from the left 0.25 s after the cut, easing out over 0.45 s, and fades up with it
    x = "-pow(1-min(1\\,max(0\\,(t-0.25)/0.45))\\,3)*320"
    fc = (f"[1:v]format=rgba,fade=t=in:st=0.25:d=0.3:alpha=1[p];"
          f"[0:v][p]overlay=x='{x}':y=0:shortest=1:format=auto,format=yuv420p[v]")
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(clip), "-loop", "1", "-i", str(png),
                    "-filter_complex", fc, "-map", "[v]", "-map", "0:a?", "-c:v", "libx264", "-preset", "medium",
                    "-crf", "18", "-c:a", "copy", str(out)], check=True)
    png.unlink(missing_ok=True)
    return out


def decorate(job: Path, clips: list, srt: Path, log=print) -> list:
    """[(clip, start, end)] -> the same list with each clip carrying its company's panel."""
    try:
        cs = _cues(srt)
    except OSError:
        return clips
    out = []
    for clip, a, b in clips:
        who = company_for(cs, a, b)
        if who:
            try:
                clip2 = _decorate_one(Path(clip), who, log)
                if clip2 != Path(clip):
                    log(f"  presenter {a:.1f}-{b:.1f}s: {who}'s mark over his shoulder")
                clip = clip2
            except Exception as e:                        # noqa: BLE001 - a panel never costs the presenter
                log(f"  presenter {a:.1f}-{b:.1f}s: no panel ({str(e)[:90]})")
        out.append((clip, a, b))
    return out
