"""factcheck.py — the script is checked before a second of it is voiced.

A documentary channel lives on its facts, and a model writes confident, plausible, wrong sentences: a date a day
off, the famous version of a story instead of the true one, a quote that was never said in those words. Once the
voice is recorded, every fix costs a new voiceover and a new render. So the check runs on the finished script,
before the voice:

    1. the narration is cut into parts of about 550 words (chapter and clip lines stay with their paragraphs);
    2. every part is checked AT THE SAME TIME by its own Claude call that can search the web (Claude Code with
       WebSearch/WebFetch, or the API's web search tool) — a 35-minute script is checked in a few minutes;
    3. each call returns only real problems — a wrong date, number, name, place or attribution, a quote that is
       not word for word, a superlative nobody can support — with the exact words to replace and the fix, in the
       script's language;
    4. the fixes are applied by exact replacement; anything that cannot be found verbatim is reported, not guessed.

The original stays next to it as script.before-factcheck.txt and the report as factcheck.json. A script that was
already checked is not checked again (the report remembers what it checked). A channel switches it off with
"look": {"factcheck": false}; FRONTIER_FACTCHECK=0 switches it off everywhere.

The texts a look kit's graphics print (a card's paragraph, a stamp, a name's line) are written by the director after
the script was checked; check_texts() checks them the same way before the graphics are rendered.
"""
import hashlib
import json
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

PART_WORDS = 550
WORKERS = int(os.environ.get("FRONTIER_FACTCHECK_WORKERS", "6"))

PROMPT = """You are the fact-checker of a documentary YouTube channel whose whole promise is REAL FACTS. The video is
titled "[INSERT TITLE HERE]"; the narration is in [INSERT LANGUAGE HERE]. Below is part [INSERT N HERE] of [INSERT OF HERE] of
its script. Check EVERY factual statement in this part: dates, times, ages, numbers, durations, names, titles,
places, who said or did what, quotes, superlatives ("first", "only", "never", "the biggest") and causes. Search the
web for anything you are not certain of — do not rely on memory for specific facts, and do not trust the famous
version of a story over the documented one.

Report ONLY real problems:
- "error": the statement is false or a detail is wrong;
- "quote": words in quotation marks (or presented as someone's words) that are not what the person said, word for
  word — the fix gives the real words or turns it into reported speech;
- "hedge": presented as certain but disputed or resting on one weak or anonymous source — the fix says who says it;
- "invented": a decorative detail (a colour, a sound, a motive, a mood, a round number) no source supports — the fix
  removes it.
What your search cannot find is not automatically false: search in the language of the country the story is about
too. Never delete a named person, event, date or quote only because your search came up empty — if you cannot
confirm it and have no evidence against it, leave it alone (or, when it carries the story, add who says it).
Never report style or rhythm. Never "fix" what is right. Lines that start with "## " or "[[" are not narration.

Return ONLY a JSON array, [] when nothing is wrong — no "Sources" section and no text after it; put the source
in each item's "why":
[{"quote": "the exact wrong words, copied character for character from the part, long enough to be unique",
  "fix": "the words that take their place in the narration, in [INSERT LANGUAGE HERE] — finished narration that fits
  the sentence, never an instruction to an editor; numbers written the way the rest of the script writes them (spelled
  out when the script spells them out); an empty string deletes the words", "kind": "error|quote|hedge|invented",
  "why": "one line: what is true, and the source"}]

PART [INSERT N HERE]:
[INSERT PART HERE]"""


def enabled(engine, style: str) -> bool:
    if os.environ.get("FRONTIER_FACTCHECK", "1").strip().lower() in ("0", "false", "no", "off"):
        return False
    look = (((getattr(engine, "STYLE_INFO", {}) or {}).get(style) or {}).get("look") or {})
    return look.get("factcheck", True) is not False


def _parts(script: str) -> list:
    """The script in parts of about PART_WORDS spoken words, cut between paragraphs."""
    paras = [p for p in re.split(r"\n\s*\n", script.strip()) if p.strip()]
    parts, cur, n = [], [], 0
    for p in paras:
        w = 0 if re.match(r"^\s*(##|\[\[)", p) else len(p.split())
        if cur and n + w > PART_WORDS and n >= PART_WORDS * 0.5:
            parts.append("\n\n".join(cur))
            cur, n = [], 0
        cur.append(p)
        n += w
    if cur:
        parts.append("\n\n".join(cur))
    return parts


# heading, clip and mood lines are not narration: they neither count, nor get checked, nor are ever rewritten
MARK = re.compile(r"^\s*(#{1,3}\s*\S|\[\[\s*(clip|mood)\s*:)", re.I)


def _narration(t: str) -> str:
    return " ".join(" ".join(ln.split()) for ln in (t or "").splitlines() if ln.strip() and not MARK.match(ln))


def _sig(t: str) -> str:
    """The same for the marked script and its clean copy (chapter lines taken out, whitespace aside)."""
    return hashlib.sha256(_narration(t).encode("utf-8")).hexdigest()[:16]


def _issues(text: str, prompt: str = "") -> tuple:
    """([issues], parsed) — the FIRST complete JSON array in the reply: web search likes to append a list of
    source links, whose brackets must not swallow the answer. A reply that repeats the prompt is no answer: a relay
    once echoed it, and its "[] when nothing is wrong" read as "checked, nothing wrong" on a script with ten errors."""
    if prompt and text:
        probe = next((ln.strip() for ln in prompt.splitlines() if ln.strip().startswith("Return ONLY a JSON array")), "")
        if probe and probe[:60] in text:
            return [], False
    dec = json.JSONDecoder()
    for m in re.finditer(r"\[", text or ""):
        try:
            got, _ = dec.raw_decode(text, m.start())
        except ValueError:
            continue
        if isinstance(got, list) and (not got or any(isinstance(x, dict) for x in got)):
            return [x for x in got if isinstance(x, dict) and str(x.get("quote") or "").strip() and "fix" in x], True
    return [], False


# a "fix" that talks to an editor instead of being narration ("Remove the quote…", "Nahraďte…", "Usuń…")
EDITOR_TALK = re.compile(r"^\W*(remove|replace|delete|change|consider|rephrase|reword|rewrite|add|cut|drop|use|say|"
                         r"odstra\w*|nahra\w*|smaž\w*|vyma\w*|změ\w*|přepi\w*|usu\w*|zamie\w*|zmie\w*|popraw\w*|"
                         r"entfern\w*|ersetz\w*|supprim\w*|remplac\w*|elimin\w*|sustitu\w*)\b", re.I)


def _apply(part: str, q: str, fx: str) -> str:
    """The part with q replaced by fx — only when q is on a narration line, appears once, the fix is narration (not
    an instruction to an editor) and not a rewrite of far more than it replaces; None otherwise."""
    if not q or q == fx or part.count(q) != 1 or len(fx) > 3 * len(q) + 200:
        return None
    if EDITOR_TALK.match(fx) and not EDITOR_TALK.match(q):
        return None
    if any(q in ln for ln in part.splitlines() if MARK.match(ln)):
        return None
    return part.replace(q, fx, 1)


def check(engine, job: Path, script: str, style: str, title: str) -> str:
    """The script with the fixes applied (the same text when nothing was wrong or the check is off)."""
    log = getattr(engine, "log", print)
    if not script.strip() or not enabled(engine, style):
        return script
    report_f = job / "factcheck.json"
    parts = _parts(script)
    try:
        done = json.loads(report_f.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        done = {}
    if done and _sig(script) == done.get("result"):
        return script                                       # already the checked text
    if done and _sig(script) == done.get("checked") and not done.get("incomplete"):
        out = list(parts)                                   # the same script again: its fixes, not a new check
        for a in done.get("applied") or []:
            k = int(a.get("part") or 0) - 1
            if 0 <= k < len(out):
                got = _apply(out[k], str(a.get("quote") or ""), str(a.get("fix") or ""))
                out[k] = got if got is not None else out[k]
        return "\n\n".join(out)
    lang = str(((getattr(engine, "STYLE_INFO", {}) or {}).get(style) or {}).get("language") or "English")
    t0 = time.time()
    log(f"fact check: {len(parts)} part(s) of the script checked side by side, with web search...")

    def one(k):
        prompt = (PROMPT.replace("[INSERT TITLE HERE]", title).replace("[INSERT LANGUAGE HERE]", lang)
                  .replace("[INSERT N HERE]", str(k + 1)).replace("[INSERT OF HERE]", str(len(parts)))
                  .replace("[INSERT PART HERE]", parts[k]))
        try:
            issues, ok = _issues(engine.claude_research(prompt), prompt)
            if not ok:
                log(f"  fact check: part {k + 1} — the answer was not a list of fixes, it stays unchecked")
            return issues, ok
        except (Exception, SystemExit) as e:                # noqa: BLE001 - one part failing never costs the video
            log(f"  fact check: part {k + 1} not checked — {str(e)[:120]}")
            return [], False

    with ThreadPoolExecutor(max_workers=max(1, min(WORKERS, len(parts)))) as ex:
        found = list(ex.map(one, range(len(parts))))
    out, applied, skipped = list(parts), [], []
    for k, (issues, _ok) in enumerate(found):
        for it in issues:
            q, fx = str(it["quote"]).strip(), str(it.get("fix") or "").strip()
            got = _apply(out[k], q, fx)
            if got is None:
                skipped.append({"part": k + 1, "quote": q, "why": it.get("why"),
                                "reason": "not found once in its part, on a marker line, or a rewrite too long"})
                continue
            out[k] = got
            applied.append({"part": k + 1, **{x: it.get(x) for x in ("quote", "fix", "kind", "why")}})
    fixed = "\n\n".join(out) if applied else script
    incomplete = not all(ok for _, ok in found)
    if applied:
        before = job / "script.before-factcheck.txt"
        if not before.exists():
            before.write_text(script, encoding="utf-8")
    report_f.write_text(json.dumps({"checked": _sig(script), "result": _sig(fixed), "incomplete": incomplete,
                                    "parts": len(parts), "seconds": round(time.time() - t0),
                                    "applied": applied, "skipped": skipped}, ensure_ascii=False, indent=1),
                        encoding="utf-8")
    kinds = {}
    for a in applied:
        kinds[a.get("kind") or "fix"] = kinds.get(a.get("kind") or "fix", 0) + 1
    log(f"fact check: {len(applied)} fix(es) in {time.time() - t0:.0f} s"
        + (f" — {', '.join(f'{v} {k}' for k, v in kinds.items())}" if kinds else " — nothing wrong found")
        + (f"; {len(skipped)} left as they were (factcheck.json)" if skipped else "")
        + ("; some parts could not be checked" if incomplete else ""))
    for a in applied[:12]:
        log(f"  ✓ {str(a.get('why') or '')[:140]}")
    return fixed


# ════════════════════════════════════════════════════════════════════════════
# THE GRAPHICS' TEXTS — what a look kit prints on screen, checked like the script
# ════════════════════════════════════════════════════════════════════════════
# The director writes the graphics after the script was checked: a card's paragraph, a bar's line under a name, a
# stamp. Those words are on screen for five seconds and were never checked — ALMANAC's first test printed "die-cast"
# for a sand-cast block. They are checked in one call, fixed by exact replacement inside their own text, and the
# report (motion/factcheck_texts.json) remembers the fixes, so a re-run applies them again without asking.

TEXTS_PROMPT = """You are the fact-checker of a documentary YouTube channel whose whole promise is REAL FACTS. The video is
titled "[INSERT TITLE HERE]"; it is in [INSERT LANGUAGE HERE]. Its narration was checked already. Below are the texts
its graphics print on screen (titles, dates, figures, captions, names), one per line, each with its id. Check EVERY
factual statement in them: dates, numbers, names, titles, places, who did what, materials and methods, superlatives.
Search the web for anything you are not certain of — do not trust the famous version of a story over the
documented one. A text that repeats a fact of the narration still has to be true.

Report ONLY real problems — "error": false; "invented": a detail no source supports; "hedge": stated as certain but
disputed. What your search cannot find is not automatically false. Never report style. Keep every fix about as long
as the words it replaces: it is printed in the same space.

Return ONLY a JSON array, [] when nothing is wrong:
[{"id": "the text's id", "quote": "the exact wrong words, copied character for character from that text", "fix": "the
words that take their place, in [INSERT LANGUAGE HERE]; an empty string deletes the words", "kind":
"error|invented|hedge", "why": "one line: what is true, and the source"}]

THE ON-SCREEN TEXTS:
[INSERT TEXTS HERE]

THE NARRATION (context):
[INSERT SCRIPT HERE]"""

# keys of a graphic that hold a picture, a search, a timing or a setting — never printed as a fact
_NOT_TEXT = {"type", "kit", "subject", "query", "thing", "words", "photo", "cutout", "portrait", "image", "media",
             "footage", "ground", "frame", "palette", "seed", "shutter", "duration", "skin", "side", "anchor", "icon",
             "colour", "color", "camera", "band", "grade", "src", "kind", "prefix", "suffix", "group", "point", "hero",
             "open", "open_at", "pull_at", "stamp_at", "split_at", "sub_at", "at", "at_s", "dur", "cue", "logo", "cut",
             "bill", "stack", "prop", "board", "wall", "variant", "decimals", "tally_seed", "misregister", "trim"}


def _text_leaves(v, path=()):
    """[(path, text)] — every string a graphic prints (and a tally's plain value), at any depth."""
    out = []
    if isinstance(v, dict):
        for k, x in v.items():
            if k in _NOT_TEXT and not (k == "value" and not path):
                continue
            if k == "value" and not path and isinstance(x, (int, float)) and not isinstance(x, bool):
                out.append(((k,), str(x)))
            else:
                out += _text_leaves(x, path + (k,))
    elif isinstance(v, list):
        for i, x in enumerate(v):
            out += _text_leaves(x, path + (i,))
    elif isinstance(v, str) and re.search(r"\w", v) and not v.startswith(("data:", "http://", "https://")) \
            and not re.search(r"\.(png|jpe?g|webp|gif|mp4|mov|json)$", v, re.I):
        out.append((path, v))
    return out


def _set_leaf(sc: dict, path: tuple, value) -> None:
    cur = sc
    for k in path[:-1]:
        cur = cur[k]
    cur[path[-1]] = value


def check_texts(engine, job: Path, scenes: list, style: str, title: str) -> int:
    """Fix the facts in the texts `scenes` (a look kit's graphics, as dicts) will print — in place. Returns the number
    of fixes applied. Off with the script's check (look.factcheck false, FRONTIER_FACTCHECK=0)."""
    log = getattr(engine, "log", print)
    if not scenes or not enabled(engine, style):
        return 0
    rows = [(f"{n + 1}.{'.'.join(str(p) for p in path)}", path, n, text)
            for n, sc in enumerate(scenes) for path, text in _text_leaves(sc)]
    if not rows:
        return 0
    sig = hashlib.sha256(json.dumps([(i, t) for i, _, _, t in rows], ensure_ascii=False).encode("utf-8")).hexdigest()[:16]
    report_f = job / "motion" / "factcheck_texts.json"
    try:
        done = json.loads(report_f.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        done = {}
    by_id = {i: (path, n, text) for i, path, n, text in rows}
    fresh = not (done.get("checked") == sig and not done.get("incomplete"))
    if fresh:
        lang = str(((getattr(engine, "STYLE_INFO", {}) or {}).get(style) or {}).get("language") or "English")
        script = ""
        try:
            script = _narration((job / "script.txt").read_text(encoding="utf-8"))[:24000]
        except OSError:
            pass
        prompt = (TEXTS_PROMPT.replace("[INSERT TITLE HERE]", title or "").replace("[INSERT LANGUAGE HERE]", lang)
                  .replace("[INSERT TEXTS HERE]", "\n".join(f"[{i}] {t}" for i, _, _, t in rows))
                  .replace("[INSERT SCRIPT HERE]", script or "(not available)"))
        t0 = time.time()
        log(f"fact check: the {len(rows)} texts of {len(scenes)} graphic(s), with web search...")
        try:
            issues, ok = _issues(engine.claude_research(prompt), prompt)
        except (Exception, SystemExit) as e:                # noqa: BLE001 - the check never costs the video
            log(f"  fact check: the graphics' texts were not checked — {str(e)[:120]}")
            issues, ok = [], False
        issues = [x for x in issues if str(x.get("id") or "").strip("[] ") in by_id]
        for x in issues:
            x["id"] = str(x["id"]).strip("[] ")
        done = {"checked": sig, "incomplete": not ok, "seconds": round(time.time() - t0),
                "applied": [{k: x.get(k) for k in ("id", "quote", "fix", "kind", "why")} for x in issues]}
    applied, skipped = 0, []
    for x in done.get("applied") or []:
        path, n, text = by_id.get(str(x.get("id")), (None, None, None))
        q, fx = str(x.get("quote") or "").strip(), str(x.get("fix") or "").strip()
        if path is None or not q or q == fx:
            continue
        if path == ("value",):
            # a tally's figure: only a plain number replaces it (kits reads the rest of the figure the same way)
            try:
                import kits
                got = kits._tally_value(fx)
            except Exception:                               # noqa: BLE001
                got = None
            if got is None:
                skipped.append(x)
                continue
            _set_leaf(scenes[n], path, got[0])
            applied += 1
            continue
        if text.count(q) != 1 or len(fx) > 2 * len(q) + 40 or (EDITOR_TALK.match(fx) and not EDITOR_TALK.match(q)):
            skipped.append(x)
            continue
        _set_leaf(scenes[n], path, text.replace(q, fx, 1))
        applied += 1
    if fresh:
        done["skipped"] = skipped
        report_f.parent.mkdir(parents=True, exist_ok=True)
        report_f.write_text(json.dumps(done, ensure_ascii=False, indent=1), encoding="utf-8")
        log(f"fact check: {applied} fix(es) in the graphics' texts"
            + (f"; {len(skipped)} left as they were" if skipped else "")
            + ("; the check did not answer — the texts stay unchecked" if done.get("incomplete") else ""))
        for x in (done.get("applied") or [])[:8]:
            log(f"  ✓ {str(x.get('why') or '')[:140]}")
    return applied
