"""threed.py — Frontier 3D: the narration told as real-time 3D scenes (faceless mannequins, real places, film light).

A scene module like maps / headlines / vox: `add_to_timeline(segs, srt, job, style, force, ...)` gets the graphics
timeline and hands it back with the 3D scenes added. The 3D takes the stretches of narration between the other scenes
(graphics, maps, pages) — 80-90 % of a 3D video (v2) — cut at the sentences, so every 3D moment starts and ends on
the words it belongs to. Real footage fills whatever is left, as in every documentary channel.

How one video's 3D is made (v2, 26 Sep 2026 night — Robin on the first test: "terrible, slow, not creative ... fast,
drone shots, FPV, cuts ... the quality check has to notice the water in the room"):
  1. moments: the free stretches of narration, cut into 4-24 s moments at sentence ends (the director splits every
     moment into 2-5 s shots), grouped into sections of ~50 s;
  2. director: ONE Claude Opus call per section writes the shots (director/prompt.md: trailer-grade grammar, money
     shots first; COOKBOOK.md; the engine catalog) — JSON only, no code per video. storyboard.py measures the board
     against the grammar (shot lengths, shots per moment, static cameras, repeats, interiors on the sea, seated figures
     standing, ship path corners, labels in the caption zone) and hands the violations to the review — no extra call;
  3. previews + review: 5 frames of every shot (a motion row: 4 %, 27 %, 50 %, 73 %, 96 % of it) -> contact sheets of
     at most 6 shots -> an Opus review that scores every shot with QUALITY.md, gets the engine's QA, the checks and the
     words under each shot, and rewrites every shot under 8/10 or with a hard fail (it may restructure a moment);
     up to `review_rounds` rounds (3), stopping early when every shot passes;
  4. final render: threed/render.py (three.js in Chromium WITH the GPU, one render at a time on this computer),
     1920x1080 30 fps, then every moment's shots are joined into one clip on the timeline (job/threed/threed_NN.mp4).
Nothing before the final render is ever shown as the video: previews live in job/threed/review/ only.

Settings: the style's `look.threed` — {"share": 0.85, "min_share": 0.8, "max_share": 0.9, "review_rounds": 3,
"sub": 6, "model": "claude-opus-5-5"}. With the Claude Code login every call runs through the `claude` CLI with the
chosen model (the review opens the sheets with its Read tool, like FOLIO) and its token use is counted in
job/threed/usage.json; otherwise Frontier's claude() / claude_vision() with their fallbacks.

    python threed.py check                      # the engine loads on this computer's GPU (writes nothing)
    python threed.py run "<job folder>"         # (re)make the 3D of an existing job whose voice is done
    python threed.py board "<job folder>"       # moments + director + previews/review only (no final render);
                                                # the other scenes' seconds from <job>/threed/segs.json if present
"""
import copy
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE / "threed"                        # the engine, the renderer and the director (self-contained)
RENDER = ROOT / "render.py"
sys.path.insert(0, str(ROOT / "director"))
import storyboard as SB                       # noqa: E402  (threed/director/storyboard.py)

MODEL = os.environ.get("THREED_MODEL", "claude-opus-5-5")
DEFAULTS = {"share": 0.85, "min_share": 0.80, "max_share": 0.90, "review_rounds": 3, "sub": 6, "model": MODEL,
            "moment_min_s": 4.0, "moment_max_s": 24.0, "moment_pref_s": 14.0, "section_s": 50.0,
            "preview_w": 640, "preview_h": 360, "preview_frac": "0.04,0.27,0.5,0.73,0.96", "pass_score": 8.0,
            "sheet_scenes": 6, "verify_last": True, "fill": False, "map_max_s": 0.0}
XF = 0.8                                      # a dissolve (then/now): its cross-fade, made in the assembly
# scenes another module put on its words: 3D never covers them. Plain graphics (docgfx doc_*, kit_*) give way only
# when the 3D would otherwise be under its minimum share.
PROTECTED = ("introcap", "map_", "headline_", "spot_", "objects_", "vox_", "strip_", "tilt_", "match_", "opening",
             "threed_")
MIN_RUN_S = 3.0                               # a gap shorter than this stays footage
_LOCK = threading.Lock()
USAGE = {"director": 0, "review": 0, "rounds": 0, "repairs": 0, "in_tokens": 0, "out_tokens": 0, "cache_tokens": 0,
         "cost_usd": 0.0, "in_chars": 0, "out_chars": 0, "calls": []}


def _cfg(engine, style: str) -> dict:
    look = ((getattr(engine, "STYLE_INFO", {}) or {}).get(style) or {}).get("look") or {}
    c = dict(DEFAULTS)
    c.update({k: v for k, v in (look.get("threed") or {}).items() if k in DEFAULTS})
    fill = c.get("fill")
    if isinstance(fill, str) and fill.lower() == "auto":
        # auto: a job with no footage switched on (YouTube, stock) is 3D everywhere the maps leave; AI images do not
        # count — make_video turns them on by itself when it finds no footage
        feats = getattr(engine, "_FEATURES", None) or {}
        fill = bool(feats) and not (feats.get("youtube") or feats.get("stock"))
    c["fill"] = bool(fill)
    if c["fill"]:                                 # a 3D-only video: the 3D takes every second the other scenes leave
        c["share"] = c["min_share"] = c["max_share"] = 1.0
    c["max_share"] = max(0.3, min(1.0 if c["fill"] else 0.95, float(c["max_share"])))
    c["min_share"] = max(0.0, min(c["max_share"], float(c["min_share"])))
    c["share"] = max(c["min_share"], min(c["max_share"], float(c["share"])))
    c["review_rounds"] = max(0, min(6, int(c["review_rounds"])))
    c["moment_max_s"] = max(c["moment_min_s"] + 2.0, float(c["moment_max_s"]))
    c["moment_pref_s"] = max(c["moment_min_s"], min(c["moment_max_s"], float(c["moment_pref_s"])))
    return c


def _say(engine, msg: str) -> None:
    (engine.log if engine is not None else print)(f"3D: {msg}")


def enabled(engine, style: str) -> bool:
    """3D runs only when the job's switches have it on AND the channel asks for it (look.threed)."""
    feats = getattr(engine, "_FEATURES", None) or {}
    look = ((getattr(engine, "STYLE_INFO", {}) or {}).get(style) or {}).get("look") or {}
    return bool(feats.get("threed")) and bool(look.get("threed"))


# ── Claude ────────────────────────────────────────────────────────────────────────────────────────────────────────────
def _count(what: str, prompt: str, out: str, meta: dict = None) -> None:
    """what one call cost: the CLI's own token counts when it reports them, the characters always"""
    meta = meta or {}
    u = meta.get("usage") or {}
    with _LOCK:
        USAGE["in_chars"] += len(prompt or "")
        USAGE["out_chars"] += len(out or "")
        USAGE["in_tokens"] += int(u.get("input_tokens") or 0)
        USAGE["out_tokens"] += int(u.get("output_tokens") or 0)
        USAGE["cache_tokens"] += int(u.get("cache_read_input_tokens") or 0) + int(u.get("cache_creation_input_tokens") or 0)
        USAGE["cost_usd"] = round(USAGE["cost_usd"] + float(meta.get("total_cost_usd") or 0.0), 4)
        USAGE["calls"].append({"what": what, "in_chars": len(prompt or ""), "out_chars": len(out or ""),
                               "in_tokens": int(u.get("input_tokens") or 0) + int(u.get("cache_read_input_tokens") or 0)
                               + int(u.get("cache_creation_input_tokens") or 0),
                               "out_tokens": int(u.get("output_tokens") or 0),
                               "cost_usd": float(meta.get("total_cost_usd") or 0.0), "s": meta.get("s")})


def _cc_ok(engine) -> bool:
    return (str(getattr(engine, "CLAUDE_PROVIDER", "")).lower() == "claudecode" and hasattr(engine, "_claude_exe")
            and not getattr(engine, "_HANDOFF_DIR", None))


def _cc(engine, prompt: str, model: str, images: list = None, what: str = "call") -> str:
    """one call through the Claude Code login (`claude -p`, JSON output so the tokens are counted); images are opened
    with its Read tool. Returns "" when the CLI could not answer (the caller falls back to Frontier's own call)."""
    paths = [str(Path(x).resolve()) for x in images or []][:10]
    full = prompt
    tools = ""
    if paths:
        tools = "Read"
        full = ("First read these image files so you can actually see them:\n" + "\n".join(f"- {x}" for x in paths)
                + "\n\n" + prompt)
    cmd = [engine._claude_exe(), "-p", "--model", model, "--tools", tools, "--strict-mcp-config", "--output-format",
           "json", "--no-session-persistence", "--disable-slash-commands", "--system-prompt", engine.CC_SYSTEM]
    if paths:
        cmd += ["--allowedTools", "Read", "--permission-mode", "dontAsk"]
        for d in sorted({str(Path(x).parent) for x in paths}):
            cmd += ["--add-dir", d]
    for attempt in range(2):
        t0 = time.time()
        try:
            r = subprocess.run(cmd, input=full, text=True, capture_output=True, env=engine._cc_env(),
                               timeout=int(getattr(engine, "CC_TIMEOUT", 900)) + 600, cwd=str(engine.CC_CWD),
                               encoding="utf-8", errors="replace")
        except (subprocess.TimeoutExpired, OSError) as e:
            _say(engine, f"{what}: Claude Code failed ({str(e)[:100]})")
            time.sleep(3)
            continue
        out, meta = (r.stdout or "").strip(), {}
        try:
            got = json.loads(out)
            if isinstance(got, list):                              # a stream of messages: the result is the last one
                got = next((x for x in reversed(got) if isinstance(x, dict) and x.get("type") == "result"), {})
            if isinstance(got, dict) and ("result" in got or got.get("type") == "result"):
                meta = got
                out = "" if got.get("is_error") else str(got.get("result") or "").strip()
        except ValueError:
            meta = {}                                              # plain text: an older CLI
        if r.returncode == 0 and out:
            meta["s"] = round(time.time() - t0, 1)
            _count(what, full, out, meta)
            return out
        low = ((r.stderr or "") + (r.stdout or "")).lower()
        _say(engine, f"{what}: Claude Code answered nothing ({((r.stderr or r.stdout or '').strip())[:100]})")
        if "authentication" in low or "oauth" in low or "usage limit" in low or "/login" in low:
            break
        time.sleep(3)
    return ""


def _ask(engine, model: str):
    def ask(prompt: str, max_tokens: int) -> str:
        with _LOCK:
            USAGE["director"] += 1
        full = prompt + engine._extra_block() if hasattr(engine, "_extra_block") else prompt
        if _cc_ok(engine):
            try:
                out = _cc(engine, full, model, what="director")
                if out:
                    return out
            except Exception as e:                                 # noqa: BLE001 - Frontier's own call below
                _say(engine, f"director: Claude Code unavailable ({str(e)[:100]})")
        out = engine.claude(full, model, max_tokens=max_tokens)
        _count("director", full, out)
        return out
    return ask


def _look(engine, prompt: str, images: list, model: str, max_tokens: int) -> str:
    """Claude looking at the contact sheets: through the Claude Code login the sheets are opened with the Read tool and
    the chosen model answers (Frontier's own vision call always uses its default model); otherwise claude_vision()."""
    with _LOCK:
        USAGE["review"] += 1
    if _cc_ok(engine):
        try:
            out = _cc(engine, prompt, model, images, what="review")
            if out:
                return out
        except Exception as e:                                     # noqa: BLE001 - the API route below still works
            _say(engine, f"review: Claude Code unavailable ({str(e)[:100]})")
    out = engine.claude_vision(prompt, list(images), model=model, max_tokens=max_tokens)
    _count("review", prompt, out)
    return out


# ── the narration: sentences on the voice's own clock ──────────────────────────────────────────────────────────────────
def sentences(engine, job: Path, srt: Path) -> list:
    """[(t0, t1, text)] — every sentence of the narration, timed word by word (whisper's word clock when it heard the
    cue, else each word by its letters inside its subtitle cue)."""
    out, cur = [], []
    for w, a, b in word_clock(engine, job, srt):
        cur.append((w, a, b))
        if re.search(r"[.!?…][\"'”’)\]]*$", w):
            out.append((cur[0][1], cur[-1][2], " ".join(x[0] for x in cur)))
            cur = []
    if cur:
        out.append((cur[0][1], cur[-1][2], " ".join(x[0] for x in cur)))
    return out


def word_clock(engine, job: Path, srt: Path) -> list:
    """[(word, t0, t1)] — every word of the narration on the voice's clock (the director cuts on words)"""
    cues = engine._parse_srt_full(srt.read_text(encoding="utf-8"))
    clock = {}
    try:
        clock = engine._word_clock(job, srt) or {}
    except Exception:                                             # noqa: BLE001 - letters instead
        clock = {}
    words = []
    for k, (st, en, txt) in enumerate(cues):
        ws = (txt or "").split()
        if not ws:
            continue
        heard = clock.get(k)
        if heard and len(heard) == len(ws):
            words += [(w, float(a), float(b)) for w, (a, b) in zip(ws, heard)]
            continue
        wt = [len(re.sub(r"\W", "", w)) + 1 for w in ws]
        tot, acc = float(sum(wt) or 1), 0
        for w, x in zip(ws, wt):
            a = st + (en - st) * acc / tot
            acc += x
            words.append((w, a, st + (en - st) * acc / tot))
    return words


def _cuts(sents: list) -> list:
    """the natural cut points: the middle of the pause after every sentence"""
    return [round((sents[i][1] + sents[i + 1][0]) / 2.0, 3) for i in range(len(sents) - 1)]


def _words_in(sents: list, a: float, b: float) -> str:
    return " ".join(t for s0, s1, t in sents if s1 > a + 0.15 and s0 < b - 0.15)


# ── moments: where the 3D goes ────────────────────────────────────────────────────────────────────────────────────────
def plan_moments(segs: list, sents: list, total: float, cfg: dict, log=print, words: list = None) -> tuple:
    """-> (moments [{id, t0, t1, text, words}], graphics to drop [paths]). The 3D takes the free stretches between the
    other scenes, trimmed at sentence ends to the channel's share (footage keeps the rest); when the other scenes
    leave less than min_share, plain graphics inside long 3D stretches give way. v2: a moment may be long (up to
    moment_max_s) — the director cuts it into 2-5 s shots anyway; `words` = [[word, start s]] for cutting on words."""
    cuts = _cuts(sents)
    occ = sorted((float(a), float(a) + float(d), str(p)) for a, p, d in segs)
    min_run = SB.engine_min_shot() if cfg.get("fill") else MIN_RUN_S

    def free_runs(occupied):
        runs, t = [], 0.0
        for a, b, _ in sorted(occupied):
            if a - t >= min_run:
                runs.append([t, a])
            t = max(t, b)
        if total - t >= min_run:
            runs.append([t, total])
        return runs

    dropped = []
    runs = free_runs(occ)
    share = sum(b - a for a, b in runs) / max(1.0, total)
    # too little room: plain graphics (not a map, page, photo...) give way, the shortest first
    while share < cfg["min_share"]:
        plain = [o for o in occ if not Path(o[2]).name.startswith(PROTECTED)]
        if not plain:
            break
        victim = min(plain, key=lambda o: o[1] - o[0])
        occ.remove(victim)
        dropped.append(victim[2])
        runs = free_runs(occ)
        share = sum(b - a for a, b in runs) / max(1.0, total)
    # too much: the last sentence of the longest stretch goes to footage, until the share fits
    guard = 0
    while share > cfg["max_share"] and guard < 200:
        guard += 1
        runs.sort(key=lambda r: r[1] - r[0], reverse=True)
        r = runs[0]
        inner = [c for c in cuts if r[0] + MIN_RUN_S <= c <= r[1] - 1.5]
        target = max(r[0] + MIN_RUN_S, r[1] - (share - cfg["share"]) * total)
        if not inner:
            runs.pop(0)                                 # one sentence long: it goes to footage whole
        else:
            r[1] = min(inner, key=lambda c: abs(c - target)) if r[1] - target > 1.0 else inner[-1]
        runs = [x for x in runs if x[1] - x[0] >= MIN_RUN_S]
        share = sum(b - a for a, b in runs) / max(1.0, total)
    runs.sort()
    # moments: a run cut at the sentence ends into moment_min_s..moment_max_s pieces (v2: 4-24 s, ~14 s preferred)
    moments = []
    for a, b in runs:
        inner = [c for c in cuts if a + 0.5 < c < b - 0.5]
        t = a
        while t < b - 0.01:
            ends = [c for c in inner if c > t + cfg["moment_min_s"] - 0.01 and c <= t + cfg["moment_max_s"]]
            if b - t <= cfg["moment_max_s"] + 2.0 or not ends:
                nxt = b if (b - t <= cfg["moment_max_s"] + 2.0 or not [c for c in inner if c > t + 0.5]) else \
                    min([c for c in inner if c > t + cfg["moment_min_s"] - 0.01] or [b])
            else:
                # prefer a cut near moment_pref_s: a few sentences, one beat of the story
                nxt = min(ends, key=lambda c: abs((c - t) - cfg["moment_pref_s"]))
            if b - nxt < cfg["moment_min_s"]:
                nxt = b                                  # never leave a sliver: the last moment takes it
            moments.append({"id": len(moments), "t0": round(t, 3), "t1": round(nxt, 3),
                            "text": _words_in(sents, t, nxt)})
            t = nxt
    moments = [m for m in moments if m["t1"] - m["t0"] >= (min_run if cfg.get("fill") else 2.0)
               and (m["text"].strip() or cfg.get("fill"))]
    for i, m in enumerate(moments):
        m["id"] = i
        if words:
            m["words"] = [[w, round(max(m["t0"], wa), 2)] for w, wa, wb in words
                          if wb > m["t0"] + 0.05 and wa < m["t1"] - 0.05]
    got = sum(m["t1"] - m["t0"] for m in moments)
    log(f"3D: moments — {len(moments)} moments, {got:.1f} s of {total:.1f} s ({100 * got / max(1.0, total):.0f} %)"
        + (f"; {len(dropped)} graphic(s) give way" if dropped else ""))
    return moments, dropped


def sections(moments: list, cfg: dict) -> list:
    """moments grouped into sections of about `section_s` of 3D — one director call each"""
    out, cur, acc = [], [], 0.0
    for m in moments:
        d = m["t1"] - m["t0"]
        if cur and acc + d > cfg["section_s"]:
            out.append(cur)
            cur, acc = [], 0.0
        cur.append(m)
        acc += d
    if cur:
        out.append(cur)
    # a short tail is not worth its own call (the prompt is ~17k tokens): it joins the section before it when the
    # two stay within 1.3 x section_s
    if len(out) >= 2:
        tail = sum(m["t1"] - m["t0"] for m in out[-1])
        prev = sum(m["t1"] - m["t0"] for m in out[-2])
        if tail < 0.4 * cfg["section_s"] and tail + prev <= 1.3 * cfg["section_s"]:
            last = out.pop()                      # pop first: `out[-2] = out[-2] + out.pop()` indexes after the pop
            out[-1] = out[-1] + last
    return out


def _context(segs: list, moments: list, total: float, sents: list) -> str:
    """what owns the seconds between the 3D moments: 2D graphics, maps, pages — or real footage"""
    rows, t = [], 0.0
    spans = sorted([(m["t0"], m["t1"], "3D") for m in moments] +
                   [(float(a), float(a) + float(d), Path(str(p)).stem) for a, p, d in segs])
    for a, b, what in spans:
        if a - t > 1.0:
            rows.append(f"{t:6.1f}-{a:6.1f} real footage: {_words_in(sents, t, a)[:160]}")
        if what != "3D":
            kind = ("map" if what.startswith("map_") else "newspaper page" if what.startswith("headline_") else
                    "real photo" if what.startswith(("spot_", "objects_")) else "2D graphic")
            rows.append(f"{a:6.1f}-{b:6.1f} {kind} ({what}): {_words_in(sents, a, b)[:160]}")
        t = max(t, b)
    if total - t > 1.0:
        rows.append(f"{t:6.1f}-{total:6.1f} real footage: {_words_in(sents, t, total)[:160]}")
    return "\n".join(rows) or "(none: the 3D carries the whole video)"


# ── rendering (threed/render.py in its own process, one GPU job at a time) ─────────────────────────────────────────────
def _render(engine, video: dict, outdir: Path, args: list, what: str, total_scenes: int = 0, progress=None) -> dict:
    outdir = Path(outdir).resolve()
    outdir.mkdir(parents=True, exist_ok=True)
    vf = outdir / "video.json"
    vf.write_text(json.dumps(video, indent=1, ensure_ascii=False), encoding="utf-8")
    cmd = [sys.executable, str(RENDER), str(vf), str(outdir)] + args
    env = dict(os.environ)
    logf = outdir / "render_stdout.log"
    t0 = time.time()
    done = 0
    with open(logf, "w", encoding="utf-8") as lf:
        p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, env=env,
                             encoding="utf-8", errors="replace", cwd=str(ROOT))
        waiting = False
        for line in p.stdout:
            lf.write(line)
            lf.flush()
            if "[gpulock]" in line and not waiting:
                waiting = True
                _say(engine, f"{what} — waiting for another render to finish (one GPU job at a time)")
            if progress and re.search(r"^\s+\S+: -> \S+\.mp4", line):
                done += 1
                progress(done)
        rc = p.wait()
    rep = {}
    try:
        rep = json.loads((outdir / "report.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        pass
    if not rep.get("scenes"):
        tail = logf.read_text(encoding="utf-8", errors="replace")[-600:] if logf.exists() else ""
        raise RuntimeError(f"{what}: the renderer stopped (exit {rc}) — {tail.strip()[-300:]}")
    rep["_s"] = round(time.time() - t0, 1)
    return rep


CODE_RE = re.compile(r"^\s*([a-z][a-z0-9_]{2,24}):\s")        # the engine's stable QA codes ("interior_water: ...")


def _issue_str(i) -> str:
    if isinstance(i, dict):
        what = i.get("code") or i.get("what") or i.get("rule") or ""
        rng = f" @ {float(i.get('from', 0)):.1f}-{float(i.get('to', 0)):.1f}s" if "from" in i else \
            (f" @ {float(i['t']):.1f}s" if isinstance(i.get("t"), (int, float)) else "")
        det = i.get("msg") or i.get("detail") or i.get("who") or ""
        return f"{what}{rng}{(': ' + str(det)) if det else ''}"[:200]
    return str(i)[:200]


def _issues(rep: dict) -> dict:
    """the engine's own checks, per scene, in words the reviewer can act on: camera QA, re-plans, load warnings, frame
    checks, locomotion, per-still warnings — and every coded issue string the engine reports anywhere in the scene's
    record (E1's `interior_water:`, `clipping:`, `face_blown:`, `blown_area:`, `label_hidden:`, `label_clipped:`,
    `static_camera:`, `heading_snap:`, `subject_small:` ... are passed through as they come)"""
    out = {}
    for s in rep.get("scenes") or []:
        v = []
        qa = s.get("qa") or {}
        load = s.get("load") or {}
        if s.get("status") == "error":
            v.append("FAILED TO BUILD: " + str(s.get("error", ""))[:220])
        # qa.issues: the camera/locomotion ranges are dicts {what, from, to}; E1's quality codes are strings
        # "<code>: text" (they never flip qa.ok) — the two are reported apart
        cam_iss = [i for i in (qa.get("issues") or []) if not isinstance(i, str)]
        codes = [i for i in (qa.get("issues") or []) if isinstance(i, str)]
        if qa and not qa.get("ok", True):
            v.append("camera QA FAILED (the scene would not be rendered): " + "; ".join(
                _issue_str(i) for i in cam_iss[:4]))
        elif cam_iss:
            v += ["camera: " + _issue_str(i) for i in cam_iss[:3]]
        v += ["engine QA: " + i[:200] for i in codes[:8]]
        cam = load.get("camera") or {}
        if cam.get("requested") and cam.get("move") and cam["requested"] != cam["move"]:
            v.append(f"the camera move was replaced: asked {cam['requested']}, got {cam['move']} (path unsafe)")
        changes = [str(c) for c in (cam.get("changes") or [])]
        dart = any("FPV dart" in c for c in changes)                  # E2 v2: an unflyable FPV is flown as a dart
        ch = [c for c in changes if any(k in c for k in ("lifted", "re-plan", "side-step", "fell back", "strict",
                                                         "break the safety", "still failing"))
              and not (dart and ("still failing" in c or "re-plan" in c))]
        if dart:
            v.append("camera: the FPV was flown as a straight FPV dart past the subject (a valid FPV shot; for the full "
                     "weave give it >= 3.6 s and more altitude)")
        if ch:
            v.append("camera safety: " + "; ".join(c[:160] for c in ch[:3]))
        for i in (cam.get("issues") or [])[:3]:
            v.append("camera: " + _issue_str(i))
        for w in (load.get("warnings") or [])[:6]:
            v.append("engine warning: " + str(w)[:160])
        fc = s.get("frame_checks") or {}
        bad = {k: fc.get(k) for k in ("black", "blown", "jumps") if fc.get(k)}
        if bad:
            v.append("frame checks: " + ", ".join(f"{k} frames {str(x[:6])}" for k, x in bad.items()))
        lo = qa.get("locomotion") or {}
        if lo and not lo.get("ok", True):
            v.append("locomotion FLAGGED: " + "; ".join(f"{f.get('who')} {f.get('what')}" for f in (lo.get("flagged") or [])[:3]))
        for st in s.get("stills") or []:
            for w in ((st.get("qa") or {}).get("warnings") or [])[:3]:
                v.append(f"at {float(st.get('t', 0)):.1f}s: {_issue_str(w)}")
        # anything else the engine flagged with a code, wherever it put it
        seen = set(v)
        stack = [(k, x) for k, x in s.items() if k not in ("stills", "load", "id", "error", "mp4")]
        stack += [(k, x) for k, x in load.items() if k not in ("warnings", "camera")]
        while stack:
            k, x = stack.pop()
            if isinstance(x, dict):
                stack += list(x.items())
            elif isinstance(x, list):
                stack += [(k, y) for y in x[:40]]
            elif isinstance(x, str) and CODE_RE.match(x):
                line = f"engine QA: {x[:200]}"
                if line not in seen and not any(x[:60] in y for y in seen):
                    seen.add(line)
                    v.append(line)
        out[str(s.get("id"))] = v[:12]
    return out


def contact_sheets(rep: dict, scenes: list, out_stem: Path, info: dict = None, per_sheet: int = 6,
                   frames: int = 5, width: int = 1920) -> tuple:
    """v2: every scene is one ROW of its `frames` preview stills (a motion strip: start -> end of the shot), at most
    `per_sheet` rows per image (~1920 px wide), the scene id, its times, move and scale over the row and each frame's
    time on the tile. -> ([sheet paths], legend lines for the prompt)"""
    from PIL import Image, ImageDraw, ImageFont
    info = info or {}
    stills = {str(s.get("id")): s.get("stills") or [] for s in rep.get("scenes") or []}
    gap, head = 6, 30
    tile_w = (width - (frames + 1) * gap) // frames
    th = int(tile_w * 9 / 16)
    try:
        font = ImageFont.truetype(str(ROOT / "engine" / "fonts" / "Inter-SemiBold.ttf"), 19)
        small = ImageFont.truetype(str(ROOT / "engine" / "fonts" / "Inter-SemiBold.ttf"), 15)
    except OSError:
        font = small = ImageFont.load_default()
    paths, legend = [], []
    chunks = [scenes[i:i + per_sheet] for i in range(0, len(scenes), per_sheet)]
    for k, chunk in enumerate(chunks):
        sheet = Image.new("RGB", (width, len(chunk) * (th + head + gap) + gap), (16, 16, 16))
        d = ImageDraw.Draw(sheet)
        for r, sc in enumerate(chunk):
            y = gap + r * (th + head + gap)
            meta = info.get(sc["id"]) or {}
            t0 = meta.get("t0")
            when = f"{t0:.1f}-{t0 + float(sc['dur']):.1f} s" if isinstance(t0, (int, float)) else f"{float(sc['dur']):.1f} s"
            title = f"{r + 1}. {sc['id']}   {when} ({float(sc['dur']):.1f} s)   {meta.get('kind', sc.get('camera', {}).get('move', ''))}" \
                    f"   {meta.get('scale', '')}"
            words = str(meta.get("words") or "")
            d.rectangle([0, y, width, y + head - 4], fill=(34, 30, 24))
            d.text((gap + 2, y + 4), title, fill=(240, 226, 190), font=font)
            if words:
                tw = d.textlength(title, font=font) if hasattr(d, "textlength") else len(title) * 10
                room = max(0, int((width - tw - 60) / 8.2))
                if room > 12:
                    d.text((gap + tw + 30, y + 7), ("“" + words[:room - 2] + ("…" if len(words) > room - 2 else "") + "”"),
                           fill=(160, 160, 150), font=small)
            got = stills.get(sc["id"]) or []
            ts = []
            for c in range(frames):
                x = gap + c * (tile_w + gap)
                st = got[c] if c < len(got) else None
                if st and Path(st.get("file", "")).exists():
                    im = Image.open(st["file"]).convert("RGB").resize((tile_w, th))
                    sheet.paste(im, (x, y + head))
                    tt = f"{float(st.get('t', 0)):.1f}s"
                    ts.append(tt)
                    bw = int(d.textlength(tt, font=small)) + 10 if hasattr(d, "textlength") else 50
                    d.rectangle([x, y + head, x + bw, y + head + 20], fill=(0, 0, 0))
                    d.text((x + 5, y + head + 1), tt, fill=(255, 255, 255), font=small)
                else:
                    d.rectangle([x, y + head, x + tile_w, y + head + th], fill=(60, 20, 20))
                    d.text((x + 12, y + head + th // 2 - 10), "NOT RENDERED", fill=(255, 190, 190), font=font)
                    ts.append("missing")
            legend.append(f"sheet {k + 1}, row {r + 1}: {sc['id']} ({when}) — frames at {', '.join(ts)}")
        p = Path(f"{out_stem}_{k + 1}.jpg")
        sheet.save(p, quality=86)
        paths.append(p)
    return paths, legend


# ── the whole 3D of one video ─────────────────────────────────────────────────────────────────────────────────────────
def _all_scenes(board: dict) -> list:
    return [s for m in board["moments"] for s in m["scenes"]]


def _video(board: dict, sub=None) -> dict:
    scenes = []
    for s in _all_scenes(board):
        s = SB.render_spec(s)                     # the director's notes (scale, beat, pov, power) stay out of the engine
        if (s.get("transition") or {}).get("in") == "dissolve":
            old = float(s["dur"])                 # its first XF s lie under the cross-fade (then/now): render XF longer
            s["dur"] = round(old + XF, 3)
            _extend_keys(s, old, s["dur"])        # and keep the camera moving through the added time
        if sub:
            s.setdefault("render", {})["sub"] = int(sub)
        scenes.append(s)
    return {"cast": board.get("cast", []), "scenes": scenes}


KEY_VALS = ("alt", "look_h", "fov")
KEY_PAIRS = ("at", "look_at", "pos", "look")


def _extend_keys(s: dict, old: float, new: float) -> None:
    """a scene rendered longer than it was designed (a dissolve's overlap) keeps its camera moving: `keys` that end at
    the old length get one more key at the new length, continuing the last segment at the same velocity (the framing
    keeps its pace; a camera that stopped at the old end failed QA as 'still' and fell back to a high flyover). Keys
    without times are spaced over the whole render by the engine and need nothing."""
    cam = s.get("camera") or {}
    ks = [k for k in cam.get("keys") or [] if isinstance(k, dict)]
    if cam.get("move") != "keys" or len(ks) < 2 or new <= old or not all(isinstance(k.get("t"), (int, float)) for k in ks):
        return
    ks = sorted(ks, key=lambda k: float(k["t"]))
    a, b = ks[-2], ks[-1]
    ta, tb = float(a["t"]), float(b["t"])
    if tb < old - 0.05 or tb - ta < 1e-3:
        return                                    # the director stopped the camera early on purpose: leave it
    f = (new - tb) / (tb - ta)
    k = {"t": round(new, 3)}
    for key in KEY_PAIRS:
        if isinstance(b.get(key), (list, tuple)) and isinstance(a.get(key), (list, tuple)) and len(a[key]) == len(b[key]):
            k[key] = [round(float(y) + (float(y) - float(x)) * f, 3) for x, y in zip(a[key], b[key])]
        elif key in b:
            k[key] = b[key]
    for key in KEY_VALS:
        if isinstance(b.get(key), (int, float)):
            va = float(a[key]) if isinstance(a.get(key), (int, float)) else float(b[key])
            k[key] = round(float(b[key]) + (float(b[key]) - va) * f, 3)
    if "fov" in k:
        k["fov"] = max(12.0, min(90.0, k["fov"]))
    if "alt" in k:
        k["alt"] = max(float(b.get("alt", 0.5)) * 0.5, k["alt"])      # never dive into the ground or the sea
    cam["keys"] = ks + [k]


def _scene_words(board: dict, sents: list) -> dict:
    """the words spoken under each shot: exact from the moment's word clock (2-5 s shots cut inside sentences),
    else the sentences that overlap it"""
    out = {}
    for m in board["moments"]:
        t = m["t0"]
        ws = m.get("words") or []
        for s in m["scenes"]:
            if ws:
                out[s["id"]] = " ".join(w for w, a in ws if t - 0.05 <= float(a) < t + s["dur"] - 0.05)
            else:
                out[s["id"]] = _words_in(sents, t, t + s["dur"])
            t += s["dur"]
    return out


def direct(engine, job: Path, style: str, title: str, moments: list, sents: list, context: str, cfg: dict,
           catalog: dict, force: bool) -> dict:
    """the storyboard: one Opus call per section, side by side (at most three at once)"""
    root = job / "threed"
    f = root / "board_director.json"
    key = hashlib.sha1(json.dumps(["v2", moments, cfg["model"], cfg["section_s"]], sort_keys=True).encode()).hexdigest()[:12]
    if f.exists() and not force:
        try:
            got = json.loads(f.read_text(encoding="utf-8"))
            if got.get("key") == key:
                _say(engine, f"director — cached storyboard ({len(_all_scenes(got['board']))} scenes)")
                return got["board"]
        except (OSError, ValueError, KeyError):
            pass
    lang = ((engine.STYLE_INFO.get(style) or {}).get("language") or "English")
    language_line = (f"Write every text that appears on screen in {lang}." if lang.lower() != "english"
                     else "Write every text that appears on screen in English.")
    secs = sections(moments, cfg)
    ask = _ask(engine, cfg["model"])
    lines = [(a, b, t) for a, b, t in sents]

    def one(k):
        part = secs[k]
        _say(engine, f"director — section {k + 1}/{len(secs)}, {len(part)} moments, "
                     f"{sum(m['t1'] - m['t0'] for m in part):.0f} s (Claude {cfg['model']})...")
        sec_name = (f"section {k + 1} of {len(secs)} of the video" if len(secs) > 1 else "the whole video")
        try:
            return SB.storyboard(ask, title, lines, part, catalog, language_line,
                                 log=lambda s: engine.log(s.strip()), context=context, section=sec_name)
        except (Exception, SystemExit) as e:                       # noqa: BLE001 - one bad section never skips the 3D
            _say(engine, f"director — section {k + 1} failed ({type(e).__name__}: {str(e)[:100]}); its moments "
                         f"go without 3D this time")
            return {"throughline": "", "cast": [], "money_shots": [], "moments": []}

    with ThreadPoolExecutor(max_workers=min(3, len(secs))) as ex:
        boards = list(ex.map(one, range(len(secs))))
    board = {"throughline": " / ".join(b.get("throughline", "") for b in boards if b.get("throughline")),
             "money_shots": [x for b in boards for x in b.get("money_shots") or []], "cast": [], "moments": []}
    seen = set()
    for b in boards:
        for c in b.get("cast") or []:
            if isinstance(c, dict) and c.get("id") and c["id"] not in seen:
                seen.add(c["id"])
                board["cast"].append(c)
        board["moments"] += b["moments"]
    board["moments"].sort(key=lambda m: m["t0"])
    if not board["moments"]:
        raise RuntimeError("every section of the storyboard failed")
    root.mkdir(parents=True, exist_ok=True)
    chk = SB.board_checks(board, catalog=catalog)
    st = chk["stats"]
    f.write_text(json.dumps({"key": key, "board": board, "stats": st}, indent=1, ensure_ascii=False), encoding="utf-8")
    _say(engine, f"director — {len(_all_scenes(board))} scenes in {len(board['moments'])} moments"
                 + (f", cast: {', '.join(c['id'] for c in board['cast'])}" if board["cast"] else ""))
    engine.log(f"  3D director: shots {st['shots']}, average {st['avg']:.1f} s, longest {st['max']:.1f} s, "
               f"{len(board['money_shots'])} money shots, {st['violations']} grammar violation(s) for the review")
    return board


def review(engine, job: Path, style: str, title: str, board: dict, sents: list, context: str, cfg: dict,
           catalog: dict, force: bool) -> dict:
    """v2: previews of every open moment (5 frames per shot) -> contact sheets (one row per shot, <= 6 shots a sheet)
    -> one Opus review call per section: it scores every shot with QUALITY.md (story, subject, motion, craft, life),
    sees the engine's QA, the grammar checks and the words under each shot, and returns full specs only for the shots
    it rewrites (every shot under `pass_score` or with a hard fail) or whole moments it restructures. A moment the
    reviewer leaves untouched is done; the others go round again, up to `review_rounds` rounds."""
    rounds = cfg["review_rounds"]
    root = job / "threed" / "review"
    f = job / "threed" / "board_reviewed.json"
    key = hashlib.sha1(json.dumps(["v2", board, rounds, cfg["preview_frac"]], sort_keys=True).encode()).hexdigest()[:12]
    if f.exists() and not force:
        try:
            got = json.loads(f.read_text(encoding="utf-8"))
            if got.get("key") == key:
                _say(engine, f"review — cached ({got.get('rounds', 0)} round(s))")
                return got["board"]
        except (OSError, ValueError, KeyError):
            pass
    if rounds <= 0:
        return board
    lang = ((engine.STYLE_INFO.get(style) or {}).get("language") or "English")
    language_line = f"Write every text that appears on screen in {lang}."
    fracs = [x for x in str(cfg["preview_frac"]).split(",") if x.strip()]
    nfr = len(fracs)
    open_moments = {m["id"] for m in board["moments"]}
    scores_all, history, story_all = {}, [], {}
    before_fix = rep_last = None
    done_rounds = 0
    # lean review: round 1 looks at every shot; later rounds only at the shots that did not pass (or were changed),
    # the last round only at hard fails — a shot that passed is approved and never paid for again
    lean = bool(cfg.get("lean_review", True))
    open_scenes = None
    for rn in range(1, rounds + 1):
        todo = [m for m in board["moments"] if m["id"] in open_moments]
        if lean and open_scenes is not None:
            todo = [dict(m, scenes=[s for s in m["scenes"] if s["id"] in open_scenes]) for m in todo]
            todo = [m for m in todo if m["scenes"]]
        if not todo:
            break
        sub = {"throughline": board.get("throughline", ""), "cast": board.get("cast", []), "moments": todo}
        scenes = _all_scenes(sub)
        rdir = root / f"r{rn}"
        if rdir.exists():
            shutil.rmtree(rdir, ignore_errors=True)
        # a later round only verifies fixes: start, middle and end of each shot are enough
        fr_now = fracs if (rn == 1 or not lean or len(fracs) <= 3) else [fracs[0], fracs[len(fracs) // 2], fracs[-1]]
        nfr = len(fr_now)
        _say(engine, f"previews — round {rn}/{rounds}, {len(scenes)} scenes, {nfr * len(scenes)} stills")
        try:
            rep = _render(engine, _video(sub), rdir,
                          ["--preview-frac", ",".join(fr_now), "--w", str(cfg["preview_w"]), "--h", str(cfg["preview_h"]),
                           "--quality", "draft"], f"previews round {rn}")
        except Exception as e:                                     # noqa: BLE001 - no previews: render as planned
            _say(engine, f"previews failed — {str(e)[:200]}; the storyboard goes to the final render as it is")
            break
        issues = _issues(rep)
        chk = SB.board_checks(board, catalog=catalog)
        words = _scene_words(board, sents)
        if lean and open_scenes is not None:
            # fewer shots are left: pack them into fewer calls (each call carries the ~17k-token prompt again)
            per = max(6, int(cfg.get("lean_call_scenes", 24)))
            secs, cur, n = [], [], 0
            for m in todo:
                if cur and n + len(m["scenes"]) > per:
                    secs.append(cur)
                    cur, n = [], 0
                cur.append(m)
                n += len(m["scenes"])
            if cur:
                secs.append(cur)
        else:
            secs = sections(todo, cfg)
        n_sheets = sum((len(_all_scenes({"moments": s})) + cfg["sheet_scenes"] - 1) // cfg["sheet_scenes"] for s in secs)
        _say(engine, f"review {rn}/{rounds} — Claude is looking at {nfr * len(scenes)} stills of {len(scenes)} scenes"
                     f" in {n_sheets} sheet(s)...")

        def one(k):
            part = {"throughline": board.get("throughline", ""), "money_shots": board.get("money_shots", []),
                    "cast": board.get("cast", []), "moments": secs[k]}
            sc = _all_scenes(part)
            info = {s["id"]: dict(chk["metrics"].get(s["id"], {}), words=words.get(s["id"], "")) for s in sc}
            paths, legend = contact_sheets(rep, sc, rdir / f"sheet_{k + 1}", info, per_sheet=int(cfg["sheet_scenes"]),
                                           frames=nfr)
            prompt = SB.review_prompt(title, part, legend, words, {s["id"]: issues.get(s["id"], []) for s in sc},
                                      rn, rounds, language_line, context, checks=chk, full_board=board, catalog=catalog)
            raw = _look(engine, prompt, paths, cfg["model"], SB.REVIEW_TOKENS)
            try:
                reply = SB._json_object(raw)
            except (ValueError, json.JSONDecodeError):
                with _LOCK:
                    USAGE["repairs"] += 1
                raw = _look(engine, prompt + "\n\nYour previous reply was not valid JSON. Output ONLY the JSON object.",
                            paths, cfg["model"], SB.REVIEW_TOKENS)
                reply = SB._json_object(raw)
            return k, reply

        with ThreadPoolExecutor(max_workers=min(3, len(secs))) as ex:
            results = list(ex.map(lambda k: _safe(engine, one, k), range(len(secs))))
        before_fix, rep_last = copy.deepcopy(board), rep
        changed_total, next_open = 0, set()
        for k, reply in results:
            ids = {m["id"] for m in secs[k]}
            if not isinstance(reply, dict):
                next_open |= ids                                   # the call failed: look again next round
                continue
            part = {"throughline": board.get("throughline", ""), "money_shots": board.get("money_shots", []),
                    "cast": board.get("cast", []), "moments": secs[k]}
            flagged = {sid for sid, lines in issues.items() if _hard(lines)}      # the engine's own verdict per shot
            if lean and open_scenes is not None:
                # only part of each moment is on the sheets now: shots may be repaired, the moment is not restructured
                reply = dict(reply)
                reply.pop("moments", None)
            new, changed, verdict, scores, touched = SB.apply_review(part, reply, catalog,
                                                                     log=lambda s: engine.log(s.strip()), flagged=flagged,
                                                                     last_round=(rn == rounds and rounds > 1))
            by = {m["id"]: m for m in new["moments"]}
            if lean and open_scenes is not None:
                def _merge(old):
                    got = {s["id"]: s for s in (by.get(old["id"]) or {}).get("scenes", [])}
                    return dict(old, scenes=[got.get(s["id"], s) for s in old["scenes"]])
                board["moments"] = [_merge(m) if m["id"] in ids else m for m in board["moments"]]
            else:
                board["moments"] = [by.get(m["id"], m) if m["id"] in ids else m for m in board["moments"]]
            board["cast"] = new.get("cast", board.get("cast", []))
            if isinstance(reply.get("money_shots"), list) and reply["money_shots"]:
                keep = [x for x in board.get("money_shots") or []
                        if str(x.get("scene")) not in {s["id"] for m in secs[k] for s in m["scenes"]}]
                board["money_shots"] = keep + new.get("money_shots", [])
            scores_all.update(scores)
            changed_total += changed
            next_open |= touched
            (rdir / f"review_{k + 1}.json").write_text(json.dumps(reply, indent=1, ensure_ascii=False), encoding="utf-8")
            notes = [str(n) for n in (reply.get("notes") or [])][:5]
            if notes:
                engine.log("  3D review: " + " | ".join(n[:110] for n in notes))
            story = [x for x in reply.get("story") or [] if isinstance(x, dict)]
            if story:
                story_all.update({str(x.get("moment")): x for x in story})
                engine.log("  3D review: story " + " | ".join(
                    f"moment {x.get('moment')}: {x.get('score')}/2" + (f" (missing {str(x.get('missing'))[:60]})"
                                                                      if x.get("missing") and str(x.get("missing")).lower()
                                                                      not in ("none", "nothing", "-") else "")
                    for x in story[:6]))
        got = [scores_all[s["id"]] for s in scenes if s["id"] in scores_all]
        avg = sum(x["total"] for x in got) / max(1, len(got))
        low = [s["id"] for s in scenes if s["id"] in scores_all and
               (scores_all[s["id"]]["total"] < cfg["pass_score"] or scores_all[s["id"]]["hard"])]
        hard = sum(1 for x in got if x["hard"])
        history.append({"round": rn, "scenes": len(scenes), "scored": len(got), "avg": round(avg, 2), "below": low,
                        "hard": hard, "changed": changed_total, "violations": chk["stats"]["violations"],
                        "scores": {s["id"]: scores_all.get(s["id"], {}).get("total") for s in scenes}})
        if lean:
            # next round: the shots that failed (or were changed and need a look); the last round: hard fails only
            last_next = (rn + 1 == rounds)
            eng_hard = {sid for sid, lines in issues.items() if _hard(lines)}
            was = {s["id"]: s for m in before_fix["moments"] for s in m["scenes"]}
            now = {s["id"]: s for m in board["moments"] for s in m["scenes"]}
            nxt = set()
            for s in scenes:
                sid = s["id"]
                sc = scores_all.get(sid)
                is_hard = bool(sc and sc.get("hard")) or sid in eng_hard
                is_low = sc is None or sc.get("total", 0) < cfg["pass_score"]
                changed_now = sid in now and json.dumps(now[sid], sort_keys=True) != json.dumps(was.get(sid), sort_keys=True)
                if is_hard or (not last_next and (is_low or changed_now)):
                    nxt.add(sid)
            nxt |= {sid for sid in now if sid not in was}                  # a shot the review added is new: look at it
            open_scenes = nxt
            open_moments = {m["id"] for m in board["moments"] if any(x["id"] in nxt for x in m["scenes"])}
        else:
            open_moments = next_open
        done_rounds = rn
        with _LOCK:
            USAGE["rounds"] += 1
        if got:
            engine.log(f"  3D review: scores {avg:.1f}/10 average over {len(got)} shots, {len(low)} under "
                       f"{cfg['pass_score']:.0f} or hard-failed ({hard} hard fail(s)), {chk['stats']['violations']} "
                       f"grammar violation(s) before the fixes")
        _say(engine, f"review {rn}/{rounds} — {changed_total} of {len(scenes)} scenes fixed"
                     + ("" if open_moments else "; the director signs off"))
    if cfg.get("verify_last") and open_moments and done_rounds == rounds and before_fix is not None:
        board = verify_last(engine, root, board, before_fix, open_moments, rep_last, cfg)
    chk = SB.board_checks(board, catalog=catalog)
    left = SB.checks_text(chk)
    if left:
        engine.log(f"  3D review: {chk['stats']['violations']} grammar violation(s) left after the review: "
                   + " | ".join(left.splitlines()[:6]))
    f.write_text(json.dumps({"key": key, "board": board, "rounds": done_rounds, "scores": scores_all,
                             "story": story_all, "history": history, "stats": chk["stats"]}, indent=1,
                            ensure_ascii=False), encoding="utf-8")
    return board


HARD_CODES = ("interior_water", "clipping", "heading_snap", "face_blown", "blown_area", "label_clipped")


def _hard(lines: list) -> set:
    """the engine findings that make a shot worse than useless: it failed to build, its camera failed QA or was
    replaced, the safety pass lifted it by metres, or a physical-correctness code (E1)"""
    out = set()
    for x in lines or []:
        if x.startswith(("FAILED TO BUILD", "camera QA FAILED", "the camera move was replaced")):
            out.add(x.split(":")[0])
        for c in HARD_CODES:
            if re.search(rf"\b{c}:", x):
                out.add(c)
        for m in re.finditer(r"lifted (\d+(?:\.\d+)?) m", x):
            if float(m.group(1)) > 3.0:
                out.add("lifted")
    return out


def verify_last(engine, root: Path, board: dict, before: dict, changed: set, rep_before: dict, cfg: dict) -> dict:
    """the last review round's fixes are never looked at again: preview the moments it changed once more (GPU only, no
    Claude call) and keep a fix only when the engine finds nothing worse in it than in the version it replaced"""
    todo = [m for m in board["moments"] if m["id"] in changed]
    if not todo:
        return board
    vdir = root / "verify"
    if vdir.exists():
        shutil.rmtree(vdir, ignore_errors=True)
    sub = {"cast": board.get("cast", []), "moments": todo}
    _say(engine, f"checking the last fixes — {len(_all_scenes(sub))} scenes, previews only (no Claude call)")
    try:
        rep = _render(engine, _video(sub), vdir, ["--preview-frac", "0.5", "--w", str(cfg["preview_w"]), "--h",
                                                  str(cfg["preview_h"]), "--quality", "draft"], "checking the last fixes")
    except Exception as e:                                         # noqa: BLE001 - keep the fixes as they are
        _say(engine, f"checking the last fixes failed — {str(e)[:160]}; the fixes go to the final render unchecked")
        return board
    now, then = _issues(rep), _issues(rep_before or {})
    old_m = {m["id"]: m for m in before["moments"]}
    reverted = []
    for i, m in enumerate(board["moments"]):
        if m["id"] not in changed or m["id"] not in old_m:
            continue
        old_s = {s["id"]: s for s in old_m[m["id"]]["scenes"]}
        same_shape = [s["id"] for s in m["scenes"]] == list(old_s)
        worse = {s["id"]: _hard(now.get(s["id"], [])) - _hard(then.get(s["id"], [])) for s in m["scenes"]}
        worse = {k: v for k, v in worse.items() if v}
        if not worse:
            continue
        if same_shape:
            m["scenes"] = [old_s[s["id"]] if s["id"] in worse else s for s in m["scenes"]]
            reverted += [f"{k} ({', '.join(sorted(v))})" for k, v in worse.items()]
        else:                                                      # a restructured moment goes back whole
            board["moments"][i] = old_m[m["id"]]
            reverted.append(f"moment {m['id']} ({', '.join(sorted(set().union(*worse.values())))})")
    engine.log("  3D review: the last fixes checked" + (f"; kept the earlier version of {', '.join(reverted)}"
                                                        if reverted else "; all kept"))
    return board


def _safe(engine, fn, k):
    try:
        return fn(k)
    except (Exception, SystemExit) as e:                           # noqa: BLE001 - one section keeps its specs
        _say(engine, f"review of section {k + 1} skipped — {str(e)[:160]}")
        return k, None


def final_render(engine, job: Path, board: dict, cfg: dict, force: bool) -> dict:
    """every scene at 1920x1080; -> {scene id: mp4}. A scene whose camera still fails QA is rendered with --force
    once; a scene that cannot be built at all is left out (its moment goes to footage)."""
    out = job / "threed" / "final"
    scenes = _all_scenes(board)
    stamp = out / "stamp.json"
    key = hashlib.sha1(json.dumps([_video(board, cfg["sub"])], sort_keys=True).encode()).hexdigest()[:12]
    have = {}
    if stamp.exists() and not force:
        try:
            st = json.loads(stamp.read_text(encoding="utf-8"))
            if st.get("key") == key:
                have = {sid: p for sid, p in (st.get("mp4") or {}).items() if Path(p).exists()}
        except (OSError, ValueError):
            have = {}
    todo = [s for s in scenes if s["id"] not in have]
    if not todo:
        _say(engine, f"final render — cached ({len(have)} scenes)")
        return have
    if out.exists() and not have:
        shutil.rmtree(out, ignore_errors=True)
    n = len(scenes)
    base = len(have)
    _say(engine, f"final render {base}/{n} scenes — 1920x1080, {cfg['sub']} sub-frames, on this computer's GPU")

    def prog(k):
        _say(engine, f"final render {base + k}/{n} scenes")
    sub = {"cast": board.get("cast", []), "moments": [{"id": 0, "scenes": todo}]}
    rep = _render(engine, _video(sub, cfg["sub"]), out, ["--quality", "final"], "final render", n, prog)
    got = dict(have)
    retry = []
    for s in rep.get("scenes") or []:
        if s.get("mp4") and Path(s["mp4"]).exists():
            got[str(s["id"])] = s["mp4"]
        elif s.get("status") == "failed_qa":
            retry.append(str(s["id"]))
    if retry:
        _say(engine, f"final render — {len(retry)} scene(s) failed the camera check, rendering them as designed")
        sub2 = {"cast": board.get("cast", []), "moments": [{"id": 0, "scenes": [s for s in todo if s["id"] in retry]}]}
        try:
            rep2 = _render(engine, _video(sub2, cfg["sub"]), out, ["--quality", "final", "--force"], "final render (forced)",
                           n, lambda k: prog(len(got) - base + k))
            for s in rep2.get("scenes") or []:
                if s.get("mp4") and Path(s["mp4"]).exists():
                    got[str(s["id"])] = s["mp4"]
        except Exception as e:                                     # noqa: BLE001
            _say(engine, f"final render (forced) failed — {str(e)[:160]}")
    stamp.write_text(json.dumps({"key": key, "mp4": got}, indent=1), encoding="utf-8")
    _say(engine, f"final render done — {len(got)} of {n} scenes in {rep.get('_s', 0) / 60:.1f} min")
    return got


# ── the final repair pass: nothing black ships ────────────────────────────────────────────────────────────────────────
# Every final clip is measured (luma p90 / mean / std at 20, 50 and 80 % of the shot). A shot that is black, near-black
# or empty (its hero off the frame, a speck, lost in the dark) is re-framed by Claude from a strip of its REAL final
# frames, checked on a 2-frame preview (one retry), else given a deterministic hero framing, and final-rendered again.
REPAIR_P90, REPAIR_STD, REPAIR_BATCH = 45.0, 5.0, 8
REPAIR_FRACS = "0.2,0.5,0.8"          # the previews look where the final measurement looks (a black start is caught)
SPACE_SKIP = ("space.starfield", "space.asteroid_field", "space.rocket_exhaust")


def _luma(path) -> dict:
    """p90 / mean / std of a frame (a still file, or an (mp4, t) pair), luma 0..255 on a 160x90 thumb"""
    import numpy as np
    try:
        if isinstance(path, tuple):
            mp4, t = path
            r = subprocess.run([os.environ.get("FFMPEG") or "ffmpeg", "-v", "error", "-ss", f"{max(0.0, t):.3f}", "-i",
                                str(mp4), "-frames:v", "1", "-vf", "scale=160:90,format=gray", "-f", "rawvideo", "-"],
                               capture_output=True, timeout=60)
            a = np.frombuffer(r.stdout, dtype=np.uint8)
            if a.size < 160 * 90:
                return {}
            a = a[:160 * 90].astype(float)
        else:
            from PIL import Image
            a = np.asarray(Image.open(path).convert("L").resize((160, 90)), dtype=float).ravel()
        return {"p90": round(float(np.percentile(a, 90)), 1), "mean": round(float(a.mean()), 1),
                "std": round(float(a.std()), 1), "lit": round(float((a > 40).mean()), 4)}
    except Exception:                                              # noqa: BLE001 - unmeasurable = not judged
        return {}


REPAIR_LIT = 0.04          # a frame reads when >= 4 % of it is lit (luma > 40): a planet on black space passes, a speck not


def _verdict(stats: list) -> list:
    """the reasons a shot is black / dark / empty, [] when it reads: ANY measured frame black — under 4 % of it lit
    (a speck, an empty void; a shot that starts from a dot or ends in the dark flashes black too) — every frame dim
    (p90 < 50 and under 10 % lit), or ANY frame empty (std < 5.5). A hero on black space is NOT black: the lit area
    counts, not the p90 of a frame that is mostly sky."""
    got = [x for x in stats if x]
    if not got:
        return ["no frames"]
    why = []
    lit = "/".join(f"{100 * x.get('lit', 0):.0f}%" for x in got)
    if any(x.get("lit", 1.0 if x["p90"] >= REPAIR_P90 else 0.0) < REPAIR_LIT for x in got):
        why.append(f"black (lit {lit})")
    elif all(x["p90"] < REPAIR_P90 + 5 and x.get("lit", 0) < 0.06 for x in got):
        why.append(f"dark (lit {lit}, p90 " + "/".join(f"{x['p90']:.0f}" for x in got) + ")")
    if any(x["std"] < REPAIR_STD + 0.5 for x in got):
        why.append("empty (std " + "/".join(f"{x['std']:.1f}" for x in got) + ")")
    return why


def _cached(cdir: Path, ids: list, specs: dict) -> dict:
    """the candidates an interrupted repair already paid for (cand.json, else the render specs in video.json with the
    board's own length back and any key the dissolve extension added dropped)"""
    got = {}
    try:
        if (cdir / "cand.json").exists():
            got = json.loads((cdir / "cand.json").read_text(encoding="utf-8"))
        elif (cdir / "video.json").exists():
            for sc in json.loads((cdir / "video.json").read_text(encoding="utf-8")).get("scenes") or []:
                sid = str(sc.get("id"))
                if sid in specs:
                    sc["dur"] = specs[sid]["dur"]
                    cam = sc.get("camera") or {}
                    if isinstance(cam.get("keys"), list):
                        cam["keys"] = [k for k in cam["keys"] if not (isinstance(k, dict) and isinstance(k.get("t"), (int, float))
                                                                      and k["t"] > float(sc["dur"]) + 0.01)] or cam["keys"]
                    sc.pop("render", None)
                    got[sid] = sc
    except (OSError, ValueError):
        return {}
    return {k: v for k, v in got.items() if k in ids}


def _cached_report(cdir: Path, ids) -> dict:
    """a preview report an interrupted repair left — only if the engine has not changed since (catalog.json is
    rewritten by every engine sync)"""
    try:
        f = cdir / "report.json"
        if f.stat().st_mtime < (ROOT / "catalog.json").stat().st_mtime:
            return {}
        rep = json.loads(f.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    have = {str(x.get("id")) for x in rep.get("scenes") or [] if x.get("stills")}
    return rep if set(ids) <= have else {}


def measure_clip(engine, mp4: str) -> tuple:
    d = engine._video_dur(Path(mp4)) if Path(mp4).exists() else 0.0
    if d <= 0:
        return [], ["missing clip"]
    stats = [_luma((mp4, d * f)) for f in (0.2, 0.5, 0.8)]
    return stats, _verdict(stats)


def _frames(mp4: str, d: float, out: Path, sid: str) -> list:
    """three 640x360 frames of a final clip (20 / 50 / 80 %) for the repair sheet"""
    got = []
    for f in (0.2, 0.5, 0.8):
        pth = out / f"{sid}_{f:.1f}.jpg"
        subprocess.run([os.environ.get("FFMPEG") or "ffmpeg", "-v", "error", "-y", "-ss", f"{d * f:.3f}", "-i", str(mp4),
                        "-frames:v", "1", "-vf", "scale=640:360", str(pth)], capture_output=True, timeout=60)
        if pth.exists():
            got.append({"t": d * f, "file": str(pth)})
    return got


def _space_body(o: dict) -> bool:
    k = str(o.get("kind", ""))
    return k.startswith("space.") and k not in SPACE_SKIP + ("space.lineup", "space.solar_system", "space.astronaut")


def rescue_spec(s: dict) -> dict:
    """a safe hero framing for a shot that stayed black: planets -> orbit_planet at ~2.6 radii (3.4 with rings), the
    lineup -> in front of the row, the Solar System -> from above its outer orbit, figures / the astronaut -> a 3/4 medium
    at eye height, a prop -> macro, a cloud world -> the lit upper decks. The purpose, the words and the length stay."""
    import math
    r = json.loads(json.dumps(s))
    objs = r.get("objects") or []
    cam = r.setdefault("camera", {})
    look = r.setdefault("look", {})
    tg = str(cam.get("target") or "")
    idx = None
    m = re.match(r"objects:(\d+)", tg)
    if m and int(m.group(1)) < len(objs):
        idx = int(m.group(1))
    if idx is None or str(objs[idx].get("kind", "")) in SPACE_SKIP:
        idx = next((i for i, o in enumerate(objs) if _space_body(o) or str(o.get("kind")) in ("space.lineup", "space.solar_system", "space.astronaut")), idx)
    biome = str((r.get("world") or {}).get("biome", ""))
    dur = float(r.get("dur", 3.0))
    if idx is not None:
        o = objs[idx]
        k = str(o.get("kind", ""))
        at = o.get("at") if isinstance(o.get("at"), (list, tuple)) else [0, 0]
        ax, az = float(at[0]), float(at[-1])
        if _space_body(o):
            rings = k in ("space.saturn", "space.uranus") and o.get("rings", True) is not False
            r["camera"] = {"move": "orbit_planet", "target": f"objects:{idx}", "dist": 3.4 if rings else 2.6, "arc": 26,
                           "el": 12, "fov": 40}
            if float(o.get("phase", 0) or 0) > 110:
                o["phase"] = 45
            look["exposure"] = max(1.2, float(look.get("exposure", 1.0) or 1.0))
            return r
        if k == "space.lineup":
            E, gap = float(o.get("earth_radius", 40)), float(o.get("gap", 0.35))
            RR = {"mercury": 0.383, "venus": 0.949, "earth": 1, "mars": 0.532, "jupiter": 11.21, "saturn": 9.45,
                  "uranus": 4.01, "neptune": 3.88, "pluto": 0.186}
            order = [p_ for p_ in (o.get("planets") or list(RR)) if p_ in RR]
            x = 0.0
            for p_ in order:
                w = E * RR[p_] * (2.3 if p_ == "saturn" else 1)
                x += 2 * w + E * gap * 2
            half = x / 2
            D = max(half * 1.75, E * 30)
            y0 = float(o.get("y", 0) or 0)
            r["camera"] = {"move": "keys", "target": f"objects:{idx}", "fov": 40, "keys": [
                {"t": 0, "pos": [ax - half * 0.05, y0 + E * 6, az + D * 1.12], "look": [ax, y0 + E * 5, az], "fov": 40},
                {"t": dur, "pos": [ax + half * 0.05, y0 + E * 5.5, az + D], "look": [ax, y0 + E * 5, az], "fov": 38}]}
            look["exposure"] = max(1.2, float(look.get("exposure", 1.0) or 1.0))
            return r
        if k == "space.solar_system":
            R0 = float(o.get("size", 400))
            a0, a1 = math.radians(20), math.radians(32)
            r["camera"] = {"move": "keys", "target": f"objects:{idx}", "fov": 40, "keys": [
                {"t": 0, "pos": [ax + 1.6 * R0 * math.cos(a0), 0.9 * R0, az + 1.6 * R0 * math.sin(a0)], "look": [ax, 0, az], "fov": 40},
                {"t": dur, "pos": [ax + 1.5 * R0 * math.cos(a1), 0.85 * R0, az + 1.5 * R0 * math.sin(a1)], "look": [ax, 0, az], "fov": 40}]}
            look["exposure"] = max(1.2, float(look.get("exposure", 1.0) or 1.0))
            return r
        if k == "space.astronaut" or k.startswith("detail."):
            y = float(o.get("y", 0) or 0)
            h = math.radians(float(o.get("heading", 180) or 180) + 35)
            dist, hy = (4.2, y + 1.3) if k == "space.astronaut" else (0.8, y + 0.15)
            fx, fz = math.sin(h), -math.cos(h)
            r["camera"] = {"move": "keys", "target": f"objects:{idx}", "limits": "macro" if k.startswith("detail.") else "eye",
                           "keys": [{"t": 0, "at": [ax + fx * dist * 1.15, az + fz * dist * 1.15], "alt": hy + 0.1, "look": [ax, hy, az], "fov": 32},
                                    {"t": dur, "at": [ax + fx * dist, az + fz * dist], "alt": hy, "look": [ax, hy, az], "fov": 30}]}
            look["exposure"] = max(1.15, float(look.get("exposure", 1.0) or 1.0))
            return r
        r["camera"] = {"move": "push_in", "target": f"objects:{idx}", "fov": 34, "speed": "slow"}
        return r
    cast = [c for c in r.get("cast") or [] if isinstance(c, dict)]
    if cast:
        r["camera"] = {"move": "push_in", "target": f"ref:{cast[0].get('ref')}", "fov": 32, "speed": "slow"}
    elif r.get("groups"):
        r["camera"] = {"move": "push_in", "target": "groups:0", "fov": 34, "speed": "slow"}
    elif biome.endswith("_clouds"):
        r["camera"] = {"move": "fall_through", "from": 700, "to": -600, "pitch": -30, "pitch_end": -20, "spin": 20, "fov": 60}
    look["exposure"] = max(1.3, float(look.get("exposure", 1.0) or 1.0))
    return r


def _preview_ok(rep: dict) -> dict:
    """{scene id: [] (it reads) | [reasons]} from a 2-frame preview render"""
    out = {}
    for sc in rep.get("scenes") or []:
        sid = str(sc.get("id"))
        cam = (sc.get("load") or {}).get("camera") or {}
        why = []
        if sc.get("status") == "error":
            why.append("failed to build")
        if cam.get("move") == "flyover_high" and cam.get("requested") != "flyover_high":
            why.append("the camera fell back to a high flyover")
        stills = [_luma(st["file"]) for st in sc.get("stills") or [] if Path(st.get("file", "")).exists()]
        why += _verdict(stills) if stills else ["no stills"]
        out[sid] = why
    return out


def repair_pass(engine, job: Path, board: dict, mp4: dict, cfg: dict, catalog: dict, sents: list, title: str,
                style: str = "3d") -> tuple:
    """measure every final clip; Claude re-frames the black/empty ones from their real frames (batches of 8, a
    preview check, one retry), a deterministic hero framing rescues the rest; the fixed shots are final-rendered and
    replace their clips. -> (board, mp4 map, summary)"""
    root = job / "threed" / "repair"
    root.mkdir(parents=True, exist_ok=True)
    order = [s["id"] for s in _all_scenes(board)]
    specs = {s["id"]: s for s in _all_scenes(board)}
    meas = {}
    with ThreadPoolExecutor(max_workers=6) as ex:
        for sid, res in zip(order, ex.map(lambda k: measure_clip(engine, mp4.get(k, "")) if mp4.get(k) else ([], ["missing clip"]), order)):
            meas[sid] = res
    flagged = [sid for sid in order if meas[sid][1]]
    summary = {"measured": len(order), "flagged": len(flagged), "fixed": 0, "rescued": 0, "unfixed": [], "fixes": {}}
    (root / "measure.json").write_text(json.dumps({k: {"stats": v[0], "why": v[1]} for k, v in meas.items()}, indent=1),
                                       encoding="utf-8")
    _say(engine, f"repair — measured {len(order)} scenes: {len(flagged)} black or empty")
    if not flagged:
        return board, mp4, summary
    words = _scene_words(board, sents)
    lang = ((getattr(engine, "STYLE_INFO", {}) or {}).get(style) or {}).get("language") or "English"
    tpl = (ROOT / "director" / "repair.md").read_text(encoding="utf-8")
    kinds = SB._kinds(catalog)
    biomes = sorted({k.split(".", 1)[1] for k in kinds if k.startswith("biome.")}) or ["plains"]
    cast_ids = {c.get("id") for c in board.get("cast", []) if isinstance(c, dict)} | {"witness"}
    moves = SB.moves_of(catalog)
    fixed, notes_all = {}, []
    todo = list(flagged)
    frames = {}
    fdir = root / "frames"
    fdir.mkdir(exist_ok=True)
    for sid in todo:
        if mp4.get(sid) and Path(mp4[sid]).exists():
            frames[sid] = _frames(mp4[sid], engine._video_dur(Path(mp4[sid])), fdir, sid)
    last_why = {sid: meas[sid][1] for sid in todo}
    # 0. the engine may have been fixed since these clips were rendered (E4: the space "ground" 10 km down): preview the
    #    flagged shots UNCHANGED first; the ones that now read only need a final re-render
    p0 = root / "p0"
    rep0 = _cached_report(p0, todo)
    if not rep0:
        shutil.rmtree(p0, ignore_errors=True)
        _say(engine, f"repair — previews of the {len(todo)} flagged shots as they are (the engine may have fixed them)")
        try:
            rep0 = _render(engine, _video({"cast": board.get("cast", []), "moments": [{"id": 0, "scenes": [specs[x] for x in todo]}]}),
                           p0, ["--preview-frac", REPAIR_FRACS, "--w", str(cfg["preview_w"]), "--h", str(cfg["preview_h"]),
                                "--quality", "draft"], "repair previews 0")
        except Exception as e:                                     # noqa: BLE001
            _say(engine, f"repair previews failed — {str(e)[:160]}")
            rep0 = {}
    ok0 = _preview_ok(rep0) if rep0 else {}
    for sid in list(todo):
        if ok0.get(sid) == []:
            fixed[sid] = specs[sid]
            summary["fixes"][sid] = "re-rendered unchanged (the engine fix)"
    st0 = {str(sc.get("id")): sc.get("stills") or [] for sc in (rep0 or {}).get("scenes") or []}
    for sid in todo:
        if sid not in fixed and st0.get(sid):
            frames[sid] = st0[sid]                                  # Claude looks at the shot as the engine renders it NOW
            last_why[sid] = ok0.get(sid) or last_why[sid]
    todo = [sid for sid in todo if sid not in fixed]
    _say(engine, f"repair — {len(fixed)} of {len(flagged)} read unchanged on this engine; {len(todo)} to re-frame")
    for attempt in (1, 2):
        if not todo:
            break
        cdir = root / f"p{attempt}"
        cached = _cached(cdir, todo, specs)
        ask_ids = [sid for sid in todo if sid not in cached]
        batches = [ask_ids[i:i + REPAIR_BATCH] for i in range(0, len(ask_ids), REPAIR_BATCH)]
        _say(engine, f"repair {attempt}/2 — Claude re-frames {len(todo)} black or empty shots in {len(batches)} call(s)..."
                     + (f" ({len(cached)} fixes kept from the interrupted run)" if cached else ""))

        def one(k):
            ids = batches[k]
            fake = {"scenes": [{"id": sid, "stills": frames.get(sid) or []} for sid in ids]}
            sc = [specs[sid] for sid in ids]
            info = {sid: {"words": words.get(sid, "")} for sid in ids}
            paths, legend = contact_sheets(fake, sc, root / f"a{attempt}_sheet_{k + 1}", info, per_sheet=REPAIR_BATCH, frames=3)
            shots = "\n\n".join(
                f"{sid} ({float(specs[sid]['dur']):.2f} s): \"{words.get(sid, '')}\"\n  measured: "
                + "; ".join(f"p90 {x.get('p90')}, mean {x.get('mean')}, std {x.get('std')}" for x in (meas[sid][0] or []) if x)
                + f"\n  why: {', '.join(last_why.get(sid) or [])}\n  spec: {json.dumps(SB.render_spec(specs[sid]), ensure_ascii=False)}"
                for sid in ids)
            prompt = (tpl.replace("[LANGUAGE LINE]", f"Write every text that appears on screen in {lang}.")
                      .replace("[TITLE]", title).replace("[SHEET]", "\n".join(legend)).replace("[SHOTS]", shots)
                      .replace("[MOVES DOC]", SB.moves_doc(catalog)).replace("[CATALOG]", SB.catalog_text(catalog)))
            raw = _look(engine, prompt, paths, cfg["model"], SB.REVIEW_TOKENS)
            try:
                return k, SB._json_object(raw)
            except (ValueError, json.JSONDecodeError):
                with _LOCK:
                    USAGE["repairs"] += 1
                raw = _look(engine, prompt + "\n\nYour previous reply was not valid JSON. Output ONLY the JSON object.",
                            paths, cfg["model"], SB.REVIEW_TOKENS)
                return k, SB._json_object(raw)

        results = []
        if batches:
            with ThreadPoolExecutor(max_workers=min(4, len(batches))) as ex:
                results = list(ex.map(lambda k: _safe(engine, one, k), range(len(batches))))
        cand = dict(cached)
        for k, reply in results:
            if not isinstance(reply, dict):
                continue
            notes_all += [str(n) for n in reply.get("notes") or []][:10]
            for f in reply.get("scenes") or []:
                sid = str((f or {}).get("id"))
                if sid in todo and isinstance(f, dict):
                    f = json.loads(json.dumps(f))
                    f["id"], f["dur"] = sid, specs[sid]["dur"]
                    for key in SB.DIRECTOR_KEYS:
                        if key in specs[sid]:
                            f[key] = specs[sid][key]
                    w = []
                    SB.clean_scene(f, kinds, cast_ids, biomes, w, moves, catalog)
                    cand[sid] = f
        if not cand:
            continue
        pdir = root / f"p{attempt}"
        rep = _cached_report(pdir, list(cand)) if cached and set(cand) <= set(cached) else {}
        if not rep:
            shutil.rmtree(pdir, ignore_errors=True)
            _say(engine, f"repair {attempt}/2 — previews of {len(cand)} fixes, 3 stills each")
            try:
                rep = _render(engine, _video({"cast": board.get("cast", []), "moments": [{"id": 0, "scenes": list(cand.values())}]}),
                              pdir, ["--preview-frac", REPAIR_FRACS, "--w", str(cfg["preview_w"]), "--h", str(cfg["preview_h"]),
                                     "--quality", "draft"], f"repair previews {attempt}")
            except Exception as e:                                 # noqa: BLE001
                _say(engine, f"repair previews failed — {str(e)[:160]}")
                continue
        else:
            _say(engine, f"repair {attempt}/2 — previews of {len(cand)} fixes kept from the interrupted run")
        try:
            (pdir / "cand.json").write_text(json.dumps(cand, ensure_ascii=False), encoding="utf-8")
        except OSError:
            pass
        ok = _preview_ok(rep)
        stills = {str(sc.get("id")): sc.get("stills") or [] for sc in rep.get("scenes") or []}
        for sid, f in cand.items():
            if ok.get(sid) == []:
                fixed[sid] = f
                summary["fixes"][sid] = f"re-framed ({(f.get('camera') or {}).get('move')})"
            else:
                last_why[sid] = ok.get(sid) or ["not previewed"]
                if stills.get(sid):
                    frames[sid] = stills[sid]                       # the retry looks at the failed fix
        todo = [sid for sid in todo if sid not in fixed]
    # the deterministic rescue: nothing black ships
    if todo:
        _say(engine, f"repair — {len(todo)} shot(s) still black: a safe hero framing for each")
        res1 = {sid: rescue_spec(specs[sid]) for sid in todo}
        try:
            rep = _cached_report(root / "p_rescue", list(res1))
            if not rep:
                shutil.rmtree(root / "p_rescue", ignore_errors=True)
                rep = _render(engine, _video({"cast": board.get("cast", []), "moments": [{"id": 0, "scenes": list(res1.values())}]}),
                              root / "p_rescue", ["--preview-frac", REPAIR_FRACS, "--w", str(cfg["preview_w"]), "--h",
                                                  str(cfg["preview_h"]), "--quality", "draft"], "repair rescue previews")
            ok = _preview_ok(rep)
        except Exception as e:                                     # noqa: BLE001
            _say(engine, f"repair rescue previews failed — {str(e)[:160]}")
            ok = {}
        for sid, f in res1.items():
            if ok.get(sid) != []:                                   # still dark: open the exposure right up
                f.setdefault("look", {})["exposure"] = max(1.8, float(f["look"].get("exposure", 1.0) or 1.0))
                summary["unfixed"].append(sid)
            fixed[sid] = f
            summary["rescued"] += 1
            summary["fixes"][sid] = f"rescued ({f['camera'].get('move')})" + ("" if ok.get(sid) == [] else " — still dark in preview")
    if not fixed:
        return board, mp4, summary
    # final render of the fixed shots, their clips replaced
    fdir2 = root / "final"
    shutil.rmtree(fdir2, ignore_errors=True)
    new_board = json.loads(json.dumps(board))
    for m in new_board["moments"]:
        m["scenes"] = [fixed.get(s["id"], s) for s in m["scenes"]]
    fx = [s for s in _all_scenes(new_board) if s["id"] in fixed]
    _say(engine, f"repair — rendering {len(fx)} fixed scenes at 1920x1080")
    n = len(fx)
    rep = _render(engine, _video({"cast": new_board.get("cast", []), "moments": [{"id": 0, "scenes": fx}]}, cfg["sub"]),
                  fdir2, ["--quality", "final", "--force"], "repair final render", n,
                  lambda k: _say(engine, f"repair — rendered {k}/{n} fixed scenes"))
    keep = job / "threed" / "final" / "_before_repair"
    keep.mkdir(parents=True, exist_ok=True)
    done = 0
    for sc in rep.get("scenes") or []:
        sid = str(sc.get("id"))
        if sc.get("mp4") and Path(sc["mp4"]).exists():
            dst = job / "threed" / "final" / f"{sid}.mp4"
            if mp4.get(sid) and Path(mp4[sid]).exists() and not (keep / f"{sid}.mp4").exists():
                shutil.copy2(mp4[sid], keep / f"{sid}.mp4")
            shutil.copy2(sc["mp4"], dst)
            mp4[sid] = str(dst)
            done += 1
            after = measure_clip(engine, str(dst))
            engine.log(f"  3D repair: {sid} — {', '.join(meas[sid][1])} -> {summary['fixes'].get(sid)}; now "
                       + (", ".join(after[1]) if after[1] else "reads (p90 " + "/".join(f"{x['p90']:.0f}" for x in after[0] if x) + ")"))
            summary.setdefault("after", {})[sid] = after
        else:
            for m in new_board["moments"]:                          # not rendered: keep the old spec with its clip
                m["scenes"] = [specs[s["id"]] if s["id"] == sid else s for s in m["scenes"]]
    summary["fixed"] = done
    summary["notes"] = notes_all[:40]
    (root / "summary.json").write_text(json.dumps(summary, indent=1, ensure_ascii=False), encoding="utf-8")
    # the job remembers the repaired board: the cached review, the final render stamp, board_final
    try:
        rf = job / "threed" / "board_reviewed.json"
        if rf.exists():
            got = json.loads(rf.read_text(encoding="utf-8"))
            got["board"] = new_board
            rf.write_text(json.dumps(got, indent=1, ensure_ascii=False), encoding="utf-8")
        st = job / "threed" / "final" / "stamp.json"
        key = hashlib.sha1(json.dumps([_video(new_board, cfg["sub"])], sort_keys=True).encode()).hexdigest()[:12]
        st.write_text(json.dumps({"key": key, "mp4": mp4}, indent=1), encoding="utf-8")
        (job / "threed" / "board_final.json").write_text(json.dumps(new_board, indent=1, ensure_ascii=False), encoding="utf-8")
    except (OSError, ValueError) as e:
        _say(engine, f"repair: could not save the repaired board — {str(e)[:120]}")
    _say(engine, f"repair done — {done} of {len(flagged)} black/empty scenes replaced ({summary['rescued']} by the safe framing)")
    return new_board, mp4, summary


def _join(engine, parts: list, out: Path, want: float, dissolves: list = None) -> bool:
    """the scenes of one moment joined into one clip, exactly as long as its words; `dissolves[i]` = a cross-fade of XF
    s between part i and i + 1 (its incoming shot was rendered XF longer, so the length still adds up)"""
    if dissolves and any(dissolves):
        if _join_xfade(engine, parts, out, want, dissolves):
            return True
        engine.log(f"  3D: {out.name}: the dissolve could not be made — joined with cuts")
    lst = out.with_suffix(".txt")
    lst.write_text("".join(f"file '{str(Path(p).resolve()).replace(chr(39), chr(39) + chr(92) + chr(39) + chr(39))}'\n"
                           for p in parts), encoding="utf-8")
    tmp = out.with_suffix(".part.mp4")
    ff = os.environ.get("FFMPEG") or "ffmpeg"
    r = subprocess.run([ff, "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy",
                        "-movflags", "+faststart", str(tmp)], capture_output=True, text=True, encoding="utf-8",
                       errors="replace")
    lst.unlink(missing_ok=True)
    got = engine._video_dur(tmp) if tmp.exists() else 0.0
    if r.returncode != 0 or got < want - 0.2:
        tmp.unlink(missing_ok=True)
        engine.log(f"  3D: joining {out.name} failed ({(r.stderr or '').strip()[:120]}, {got:.1f}/{want:.1f} s)")
        return False
    os.replace(tmp, out)
    return True


def _join_xfade(engine, parts: list, out: Path, want: float, dissolves: list) -> bool:
    ff = os.environ.get("FFMPEG") or "ffmpeg"
    durs = [engine._video_dur(Path(p)) for p in parts]
    if not all(d > XF + 0.1 for d in durs):
        return False
    chains, cur, length = [], "v0", durs[0]
    for i, p in enumerate(parts):
        chains.append(f"[{i}:v]fps=30,format=yuv420p,setpts=PTS-STARTPTS,settb=AVTB[v{i}]")   # one timebase for all
    for i in range(1, len(parts)):
        nxt = f"x{i}"
        if i - 1 < len(dissolves) and dissolves[i - 1]:
            chains.append(f"[{cur}][v{i}]xfade=transition=fade:duration={XF}:offset={max(0.0, length - XF):.4f},settb=AVTB[{nxt}]")
            length += durs[i] - XF
        else:
            chains.append(f"[{cur}][v{i}]concat=n=2:v=1:a=0,settb=AVTB[{nxt}]")
            length += durs[i]
        cur = nxt
    tmp = out.with_suffix(".part.mp4")
    cmd = [ff, "-y", "-v", "error"]
    for p in parts:
        cmd += ["-i", str(Path(p).resolve())]
    cmd += ["-filter_complex", ";".join(chains), "-map", f"[{cur}]", "-an", "-c:v", "libx264", "-preset", "slow",
            "-crf", "16", "-pix_fmt", "yuv420p", "-color_range", "tv", "-colorspace", "bt709", "-color_primaries",
            "bt709", "-color_trc", "bt709", "-r", "30", "-movflags", "+faststart", str(tmp)]
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    got = engine._video_dur(tmp) if tmp.exists() else 0.0
    if r.returncode != 0 or got < want - 0.2:
        tmp.unlink(missing_ok=True)
        engine.log(f"  3D: dissolving {out.name} failed ({(r.stderr or '').strip()[:120]}, {got:.1f}/{want:.1f} s)")
        return False
    os.replace(tmp, out)
    return True


def _map_cap(segs: list, cfg: dict, log) -> list:
    """maps stay short in a 3D video (look.threed.map_max_s): a longer map keeps its first map_max_s seconds (its
    route and labels) and the 3D takes the rest"""
    cap = float(cfg.get("map_max_s") or 0)
    if cap <= 0:
        return segs
    out = []
    for a, p, d in segs:
        if Path(str(p)).name.startswith("map_") and float(d) > cap + 0.05:
            log(f"3D: {Path(str(p)).name} kept to {cap:.1f} s of its {float(d):.1f} s (the 3D takes the rest)")
            out.append((a, p, cap))
        else:
            out.append((a, p, d))
    return out


LOCK_NAME = "lock.json"


def _read_lock(job: Path):
    """the finished 3D of a job (threed/lock.json): its clips on the timeline — used as they are when every clip still
    exists (a sound- or assembly-only re-run never re-plans, re-directs or re-renders a finished video)"""
    f = job / "threed" / LOCK_NAME
    if not f.exists():
        return None
    try:
        lk = json.loads(f.read_text(encoding="utf-8"))
        clips = [(float(a), str(p), float(d)) for a, p, d in lk.get("clips") or []]
    except (OSError, ValueError, TypeError):
        return None
    if not clips or not all(Path(p).exists() for _, p, _ in clips):
        return None
    lk["clips"] = clips
    return lk


def _apply_lock(segs: list, lk: dict) -> list:
    clips = lk["clips"]
    fixed = {str(p): (float(a), float(d)) for a, p, d in lk.get("timeline") or [] if not Path(str(p)).name.startswith("threed_")}
    kept = []
    for x in segs:
        pth = str(x[1])
        if pth in fixed:                                           # a map the 3D shortened keeps the locked length
            kept.append((fixed[pth][0], x[1], fixed[pth][1]))
        elif not any(float(x[0]) < a + d - 0.05 and float(x[0]) + float(x[2]) > a + 0.05 for a, _, d in clips):
            kept.append(x)
    return sorted(kept + list(clips), key=lambda y: float(y[0]))


def write_lock(job: Path, clips: list, timeline: list = None) -> None:
    f = job / "threed" / LOCK_NAME
    f.write_text(json.dumps({"version": 1, "written": time.strftime("%Y-%m-%d %H:%M:%S"),
                             "note": "the finished 3D of this video: re-runs use these clips as they are; delete this "
                                     "file to plan, direct and render the 3D again",
                             "clips": [[float(a), str(p), float(d)] for a, p, d in clips],
                             "timeline": [[float(a), str(p), float(d)] for a, p, d in (timeline or [])]}, indent=1),
                 encoding="utf-8")


def relock(engine, job: Path, board: dict, mp4: dict) -> list:
    """re-join every moment from the current scene clips (after a repair replaced some) and write the lock"""
    root = job / "threed"
    added = []
    for m in board["moments"]:
        parts = [mp4.get(s["id"]) for s in m["scenes"]]
        if not parts or not all(parts) or not all(Path(p).exists() for p in parts):
            _say(engine, f"moment {m['id']} ({m['t0']:.1f}-{m['t1']:.1f} s) is missing a scene — left out of the lock")
            continue
        dur = m["t1"] - m["t0"]
        clip = root / f"threed_{int(m['id']):02d}.mp4"
        dissolves = [(s.get("transition") or {}).get("out") == "dissolve" for s in m["scenes"][:-1]]
        sig = hashlib.sha1(json.dumps([parts, [os.path.getmtime(p) for p in parts], m["t0"], m["t1"], dissolves]).encode()).hexdigest()[:12]
        stamp = clip.with_suffix(".json")
        ok = clip.exists() and stamp.exists()
        if ok:
            try:
                ok = json.loads(stamp.read_text(encoding="utf-8")).get("sig") == sig
            except (OSError, ValueError):
                ok = False
        if not ok and not _join(engine, parts, clip, dur, dissolves):
            continue
        stamp.write_text(json.dumps({"sig": sig, "t0": m["t0"], "t1": m["t1"], "scenes": [s["id"] for s in m["scenes"]],
                                     "words": " ".join(str(w[0]) for w in m.get("words") or [])[:400]}, ensure_ascii=False),
                         encoding="utf-8")
        added.append((float(m["t0"]), str(clip), float(dur)))
    write_lock(job, added)
    _say(engine, f"locked — {len(added)} clips on the timeline written to threed/{LOCK_NAME}")
    return added


def _reset_usage() -> None:
    for k in USAGE:
        USAGE[k] = [] if isinstance(USAGE[k], list) else 0.0 if isinstance(USAGE[k], float) else 0


def _usage_line() -> str:
    tok = USAGE["in_tokens"] + USAGE["cache_tokens"]
    return (f"Claude: {USAGE['director']} director + {USAGE['review']} review calls, {USAGE['rounds']} review round(s)"
            + (f", {tok / 1000:.0f}k in / {USAGE['out_tokens'] / 1000:.0f}k out tokens" if tok or USAGE["out_tokens"] else
               f", ~{USAGE['in_chars'] / 3200:.0f}k in / ~{USAGE['out_chars'] / 3200:.0f}k out tokens (estimated)")
            + (f", ${USAGE['cost_usd']:.2f} at API prices" if USAGE["cost_usd"] else ""))


def add_to_timeline(segs: list, srt: Path, job: Path, style: str, force: bool, workers: int = 1,
                    engine=None, total: float = 0.0, until: str = "final") -> list:
    """The 3D scenes of this video, dropped into the graphics timeline. Never costs the video: anything going wrong
    leaves the timeline as it was (footage fills the time). until="review": stop after the review (no final render,
    the timeline comes back unchanged) — for testing the director."""
    if engine is None:
        import make_video as engine
    if not enabled(engine, style):
        return segs
    lk = _read_lock(job)
    if lk and not force:
        out = _apply_lock(segs, lk)
        _say(engine, f"locked — {len(lk['clips'])} finished 3D clips used as they are (no planning, director, review or "
                     f"render; delete threed/{LOCK_NAME} to redo the 3D)")
        return out
    t_start = time.time()
    _reset_usage()
    cfg = _cfg(engine, style)
    if not RENDER.exists():
        _say(engine, "the engine is missing (threed/render.py) — install Frontier again")
        return segs
    if not srt.exists():
        return segs
    total = total or engine._audio_dur(job / "audio.mp3")
    root = job / "threed"
    root.mkdir(parents=True, exist_ok=True)
    title = ""
    try:
        title = (job / "title.txt").read_text(encoding="utf-8").splitlines()[0].strip()
    except (OSError, IndexError):
        pass
    engine.step("3D scenes (Claude directs and reviews, the GPU renders)")
    sents = sentences(engine, job, srt)
    if not sents:
        _say(engine, "no narration to put 3D on")
        return segs
    segs_in = segs                                # a failed 3D gives the other scenes back untouched (maps too)
    segs = _map_cap(segs, cfg, engine.log)
    moments, dropped = plan_moments(segs, sents, total, cfg, log=engine.log, words=word_clock(engine, job, srt))
    if not moments:
        _say(engine, "no stretch of narration is free for 3D this time")
        return segs_in
    (root / "moments.json").write_text(json.dumps(moments, indent=1, ensure_ascii=False), encoding="utf-8")
    base = [x for x in segs if str(x[1]) not in set(dropped)]
    context = _context(base, moments, total, sents)
    catalog = json.loads((ROOT / "catalog.json").read_text(encoding="utf-8"))
    try:
        board = direct(engine, job, style, title, moments, sents, context, cfg, catalog, force)
        board = review(engine, job, style, title, board, sents, context, cfg, catalog, force)
        for m in board["moments"]:                # a dissolve joins two shots of one moment, both sides said so
            warn = []
            SB.pair_dissolves(m["scenes"], warn, m["id"])
            for w in warn:
                engine.log(f"  3D: {w}")
        if until == "review":
            el = int(time.time() - t_start)
            _say(engine, f"stopped after the review ({_usage_line()}; {el // 60}:{el % 60:02d})")
            (root / "usage.json").write_text(json.dumps(dict(USAGE, seconds=el, until="review"), indent=1),
                                             encoding="utf-8")
            return segs
        mp4 = final_render(engine, job, board, cfg, force)
        try:                                      # nothing black ships: a failed repair never costs the video
            board, mp4, _rs = repair_pass(engine, job, board, mp4, cfg, catalog, sents, title, style)
        except (Exception, SystemExit) as e:      # noqa: BLE001
            _say(engine, f"repair skipped — {type(e).__name__}: {str(e)[:200]}")
    except (Exception, SystemExit) as e:                           # noqa: BLE001 - 3D is never worth the video
        _say(engine, f"skipped this time — {type(e).__name__}: {str(e)[:240]}")
        return segs_in
    (root / "board_final.json").write_text(json.dumps(board, indent=1, ensure_ascii=False), encoding="utf-8")
    _say(engine, f"assembly — joining {len(mp4)} scenes into {len(board['moments'])} clips on the narration")
    added = []
    for m in board["moments"]:
        parts = [mp4.get(s["id"]) for s in m["scenes"]]
        if not parts or not all(parts):
            _say(engine, f"moment {m['id']} ({m['t0']:.1f}-{m['t1']:.1f} s) is missing a scene — footage takes it")
            continue
        dur = m["t1"] - m["t0"]
        clip = root / f"threed_{int(m['id']):02d}.mp4"
        dissolves = [(s.get("transition") or {}).get("out") == "dissolve" for s in m["scenes"][:-1]]
        sig = hashlib.sha1(json.dumps([parts, [os.path.getmtime(p) for p in parts], m["t0"], m["t1"], dissolves]).encode()).hexdigest()[:12]
        stamp = clip.with_suffix(".json")
        ok = clip.exists() and stamp.exists() and not force
        if ok:
            try:
                ok = json.loads(stamp.read_text(encoding="utf-8")).get("sig") == sig
            except (OSError, ValueError):
                ok = False
        if not ok and not _join(engine, parts, clip, dur, dissolves):
            continue
        stamp.write_text(json.dumps({"sig": sig, "t0": m["t0"], "t1": m["t1"], "scenes": [s["id"] for s in m["scenes"]],
                                     "words": m.get("text", "")[:400]}, ensure_ascii=False), encoding="utf-8")
        added.append((float(m["t0"]), str(clip), float(dur)))
    if not added:
        _say(engine, "no 3D clip made it — footage takes their time")
        return segs_in
    kept = [x for x in segs if str(x[1]) not in set(dropped) and not any(
        float(x[0]) < a + d - 0.05 and float(x[0]) + float(x[2]) > a + 0.05 for a, _, d in added)]
    got = sum(d for _, _, d in added)
    el = int(time.time() - t_start)
    _say(engine, f"{len(added)} clips on the timeline, {got:.0f} s = {100 * got / max(1.0, total):.0f} % of the video "
                 f"({_usage_line()}; {el // 60}:{el % 60:02d})")
    (root / "usage.json").write_text(json.dumps(dict(USAGE, seconds=el, share=round(got / max(1.0, total), 3)),
                                                indent=1), encoding="utf-8")
    out = sorted(kept + added, key=lambda x: float(x[0]))
    try:
        write_lock(job, added, out)
    except OSError as e:
        _say(engine, f"could not write the lock — {str(e)[:120]}")
    return out


# ── command line ──────────────────────────────────────────────────────────────────────────────────────────────────────
def _check() -> int:
    """the engine loads on this computer's GPU: writes the catalog to a temp file and reads the WebGL renderer"""
    import tempfile
    out = Path(tempfile.gettempdir()) / "frontier3d_catalog_check.json"
    r = subprocess.run([sys.executable, str(RENDER), "--catalog", str(out)], capture_output=True, text=True,
                       encoding="utf-8", errors="replace", cwd=str(ROOT))
    print((r.stdout or "").strip()[-400:] or (r.stderr or "").strip()[-400:])
    ok = r.returncode == 0 and out.exists()
    out.unlink(missing_ok=True)
    print("Frontier 3D: ready" if ok else "Frontier 3D: the engine did not load (see above)")
    return 0 if ok else 1


def _run(job: Path, until: str = "final") -> int:
    import make_video as mv
    import styles
    styles.load_all()
    try:
        import motion
        styles.apply_to_engine(mv, motion)
    except Exception:                                              # noqa: BLE001
        styles.apply_to_engine(mv, None)
    style = (job / "style.txt").read_text(encoding="utf-8").strip() if (job / "style.txt").exists() else "3d"
    mv._FEATURES["threed"] = True
    segs = []
    sf = job / "threed" / "segs.json"                              # the other scenes' seconds: [[t0, path, dur], ...]
    if until == "review" and sf.exists():
        try:
            segs = [(float(a), str(p), float(d)) for a, p, d in json.loads(sf.read_text(encoding="utf-8"))]
        except (OSError, ValueError, TypeError):
            segs = []
    out = add_to_timeline(segs, job / "subs.srt", job, style, "--force" in sys.argv, engine=mv, until=until)
    print(json.dumps(out, indent=1))
    return 0


def _lock_cli(job: Path) -> int:
    """python threed.py lock "<job>": re-join every moment from threed/final (after a repair) and write the lock"""
    import make_video as mv
    board = json.loads((job / "threed" / "board_final.json").read_text(encoding="utf-8"))
    st = json.loads((job / "threed" / "final" / "stamp.json").read_text(encoding="utf-8"))
    mp4 = {k: v for k, v in (st.get("mp4") or {}).items() if Path(v).exists()}
    for s in _all_scenes(board):
        f = job / "threed" / "final" / f"{s['id']}.mp4"
        if s["id"] not in mp4 and f.exists():
            mp4[s["id"]] = str(f)
    added = relock(mv, job, board, mp4)
    print(json.dumps({"clips": len(added), "moments": len(board["moments"])}, indent=1))
    return 0


def _repair_cli(job: Path) -> int:
    """python threed.py repair "<job>": the final repair pass on a job whose 3D is already rendered (threed/final)"""
    import make_video as mv
    import styles
    styles.load_all()
    try:
        import motion
        styles.apply_to_engine(mv, motion)
    except Exception:                                              # noqa: BLE001
        styles.apply_to_engine(mv, None)
    style = (job / "style.txt").read_text(encoding="utf-8").strip() if (job / "style.txt").exists() else "3d"
    cfg = _cfg(mv, style)
    catalog = json.loads((ROOT / "catalog.json").read_text(encoding="utf-8"))
    board = json.loads((job / "threed" / "board_final.json").read_text(encoding="utf-8"))
    st = json.loads((job / "threed" / "final" / "stamp.json").read_text(encoding="utf-8"))
    mp4 = {k: v for k, v in (st.get("mp4") or {}).items() if Path(v).exists()}
    for s in _all_scenes(board):                                   # a clip the stamp lost is still on disk
        f = job / "threed" / "final" / f"{s['id']}.mp4"
        if s["id"] not in mp4 and f.exists():
            mp4[s["id"]] = str(f)
    sents = sentences(mv, job, job / "subs.srt")
    title = ""
    try:
        title = (job / "title.txt").read_text(encoding="utf-8").splitlines()[0].strip()
    except (OSError, IndexError):
        pass
    _reset_usage()
    t0 = time.time()
    board, mp4, summary = repair_pass(mv, job, board, mp4, cfg, catalog, sents, title, style)
    relock(mv, job, board, mp4)
    el = int(time.time() - t0)
    (job / "threed" / "repair" / "usage.json").write_text(json.dumps(dict(USAGE, seconds=el), indent=1), encoding="utf-8")
    print(json.dumps({k: v for k, v in summary.items() if k not in ("after", "notes")}, indent=1))
    print(_usage_line(), f"{el // 60}:{el % 60:02d}")
    return 0


if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] == "check":
        sys.exit(_check())
    if len(sys.argv) >= 3 and sys.argv[1] == "run":
        sys.exit(_run(Path(sys.argv[2])))
    if len(sys.argv) >= 3 and sys.argv[1] == "board":
        sys.exit(_run(Path(sys.argv[2]), until="review"))
    if len(sys.argv) >= 3 and sys.argv[1] == "repair":
        sys.exit(_repair_cli(Path(sys.argv[2])))
    if len(sys.argv) >= 3 and sys.argv[1] == "lock":
        sys.exit(_lock_cli(Path(sys.argv[2])))
    print(__doc__)
