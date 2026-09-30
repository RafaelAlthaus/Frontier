"""storyboard.py — the Frontier 3D director (v2, 26 Sep 2026 night): narration + 3D moments + the engine catalog + the
cookbook -> a validated storyboard ({throughline, money_shots, cast, moments:[{id, scenes:[spec...]}]}), the checks
that measure it against the v2 grammar (shot lengths, shots per moment, static cameras, repeats, the cold open,
interiors on the sea, seated figures, ship path corners, labels in the caption zone), and the review-and-fix step that
looks at contact sheets of 5-frame motion rows and returns scores plus fixed specs.

v2 pacing (Robin on the Titanic test: "terrible, slow, not creative ... fast, drone shots, FPV, cuts"): shots of
2-5 s, a moment of N s gets >= ceil(N/4) shots, a hard max of 8 s, every shot moves. The checks never cost a call:
their violations go to the next call (the review), which may restructure a moment (split, merge, re-time its shots).

Frontier-agnostic: the caller passes `ask(prompt, max_tokens) -> str` (Frontier's engine.claude with its provider
fallbacks) and `look(prompt, images, max_tokens) -> str` (Claude with vision). No code is generated per video — only
this JSON. Both calls are Opus-sized (thinking is spent out of max_tokens), so the budgets are large."""
import copy
import difflib
import json
import math
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
BASE_MOVES = ["fpv_flythrough", "reveal_rise", "orbit", "push_in", "crane_down", "flyover_high", "follow", "pull_back",
              "through", "pov", "keys"]
MOVES = list(BASE_MOVES)                     # the engine's moves come from the catalog (moves_of) when it lists them
TRANSITIONS = ["warp", "whiteout", "cut", "dissolve"]
TIMES = ["dawn", "morning", "noon", "afternoon", "golden", "dusk", "night", "overcast"]
SKIES = ["clear", "scattered", "overcast", "storm", "smoke", "storm_green"]
GRADES = ["neutral", "warm", "cold", "sepia", "bleach"]
LABEL_STYLES = ["stone", "bronze", "gold", "clay", "neon", "ice", "almanac", "almanac_sans"]
STORY_LABELS = ("almanac", "almanac_sans")
SCALES = ["extreme_wide", "wide", "medium", "close", "insert"]
SCALE_ALIASES = {"xw": "extreme_wide", "ews": "extreme_wide", "xws": "extreme_wide", "extreme wide": "extreme_wide",
                 "establishing": "extreme_wide", "aerial": "extreme_wide", "ws": "wide", "full": "wide",
                 "ms": "medium", "mid": "medium", "medium_wide": "medium", "cowboy": "medium", "mcu": "close",
                 "cu": "close", "closeup": "close", "close_up": "close", "ecu": "insert", "detail": "insert",
                 "extreme_close": "insert", "macro": "insert"}
DIRECTOR_KEYS = ("scale", "beat", "money", "pov", "power")   # the director's notes: stripped before the engine sees it
SEA_BIOMES = ("ocean", "open_sea", "coast")
INTERIOR_WORLD = {"biome": "plains", "relief": 0, "vegetation": 0}   # a closed set stands on plain dry ground
DIRECTOR_TOKENS = 32000
REVIEW_TOKENS = 32000

# the v2 grammar in numbers (prompt.md says the same; the checks below measure it)
MIN_SHOT = 2.0            # the engine's shortest scene (spec.js clamps dur); engine_min_shot() reads the live value
MAX_SHOT = 8.0            # hard max
HOLD_SHOT = 5.0           # a shot over this is an "emotional hold": one per minute of 3D
FIRST_MAX = 3.0           # the first shot of the video
COLD_OPEN_S = 10.0        # the cold open: >= COLD_OPEN_MIN shots in its first 10 s
COLD_OPEN_MIN = 3
SECONDS_PER_SHOT = 4.0    # a moment of N s gets >= ceil(N / 4) shots
STILL_MAX = 2.5           # a still frame only as a sting of <= 2.5 s
LABEL_EVERY_S = 10.0      # at most one story label per ~10 s
ZOOM_MIN, ARC_MIN, PAN_MIN = 0.15, 8.0, 8.0     # a keys shot changes size >= 15 %, or angle / view >= 8 deg (x dur/4)
SHIP_TURN_MAX = 10.0      # heading change per path point (deg) for ships
VEHICLE_TURN_MAX = 25.0
PERSON_MIN_FRAC = 0.15    # a person in a character shot: >= 15 % of the frame height
SHIP_MIN_FRAC = 0.30      # a ship in its hero shot: >= 30 % of the frame width
ASPECT = 16 / 9
DRONE = ("fpv_flythrough", "fpv_dive", "tracking_low", "reveal_rise", "orbit", "crane_down")   # Robin: drone + FPV
FPV = ("fpv_dive", "fpv_flythrough", "tracking_low")
DRONE_EVERY_S = 10.0      # at least one drone move per ~10 s of exterior shots
OTHER_SHIPS = re.compile(r"\b(carpathia|californian|olympic|britannic|lusitania|rescue ship|another ship|second ship)\b", re.I)
POWER_EVERY_S = 15.0      # a 3D superpower at least every ~15 s of 3D, and one in the cold open
POWERS = ("bullet_time", "time_compression", "scale", "impossible_pov", "globe_dive", "then_now", "cutaway",
          "underwater", "wreck_today")
# the words that name something the detail kit can show (checked only when the catalog lists the kind)
DETAIL_WORDS = [
    (r"\b(\d{1,2}[:.]\d{2}|o'clock|midnight|(ten|twenty|quarter|half) past (one|two|three|four|eleven|twelve)|"
     r"(eleven|twelve|one|two|three|four) (ten|fifteen|twenty|thirty|forty|forty-five|fifty))\b",
     ("detail.wall_clock", "detail.watch", "detail.clock")),
    (r"\bbells?\b", ("detail.bell",)),
    (r"\b(telegraph|full astern|full speed|engine orders?|stop (the )?engines?)\b", ("detail.telegraph",)),
    (r"\b(distress (call|signal)|cqd|sos|wireless|marconi|morse)\b", ("detail.wireless",)),
    (r"\b(plans?|blueprints?|drawings?|compartments?|bulkheads?)\b", ("detail.papers",)),
    (r"\b(letter|telegram|newspaper|headlines?|chart)\b", ("detail.papers",)),
    (r"\b(lifebuoys?|life ?rings?|life ?belts?|life ?jackets?)\b", ("detail.lifebuoy",)),
    (r"\b(lanterns?)\b", ("detail.lantern",)),
    (r"\b(plates|china|dishes|cutlery|tableware|dinner)\b", ("detail.tableware",)),
]
NOT_PEOPLE = {"north", "south", "east", "west", "atlantic", "pacific", "new", "york", "april", "may", "june", "march",
              "january", "february", "july", "august", "september", "october", "november", "december", "monday",
              "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "the", "her", "his", "their", "at",
              "in", "on", "by", "subscribe", "white", "star", "line", "royal", "navy", "god"}
SIZES = {"ship.liner_1912": (269.0, 28.0), "ship.warship": (180.0, 26.0), "ship.sailing_ancient": (40.0, 10.0),
         "ship.troller": (12.0, 4.0), "ship.longtail": (10.0, 2.0), "ship.rowboat": (7.0, 2.0)}

SPEC_DOC = """{ "id": "m0_liner", "dur": 2.6, "scale": "extreme_wide|wide|medium|close|insert", "beat": "what the viewer sees and why",
  "look": {"time": "dawn|morning|noon|afternoon|golden|dusk|night|overcast", "sky": "clear|scattered|overcast|storm|smoke|storm_green",
           "fog": 0..1, "haze": 0..1, "grade": "neutral|warm|cold|sepia|bleach", "exposure": 1.0},
  "weather": {"rain": 0..1, "snow": 0..1, "dust": 0..1, "ash": 0..1, "embers": 0..1, "wind": 0..1},
  "world": {"biome": "<a biome>", "seed": 1, "relief": 0..1, "vegetation": 0..1, "season": "spring|summer|autumn|winter",
            "coast": {"sea": "east", "shore": 60, "cliffs": "none"}, "grass_radius": 80,
            "features": [{"type": "road|river|lake|ridge|valley|forest_edge|cliff", "from": [x,z], "to": [x,z], "at": [x,z]}]},
  "cast": [{"ref": "<cast id>", "at": [x,z], "heading": deg, "action": "<an action>", "path": [[x,z],...], "point_at": [x,z],
            "actions": [{"t": s, "action": "<an action>"}]}],
  "groups": [{"kind": "<figure.* kind>", "count": n, "formation": "column|line|square|crowd|scatter", "at": [x,z],
              "size": [w,d], "heading": deg, "action": "<an action>", "speed": m_per_s, "path": [[x,z],...], "params": {}}],
  "objects": [{"kind": "<kind>", "at": [x,z], "heading": deg, "action": "<an action>", "speed": m_per_s, "path": [[x,z],...], "params": {}}],
  "structures": [{"kind": "<kind>", "at": [x,z], "heading": deg, "size": "small|medium|large", "params": {}}],
  "labels": [{"text": "Place", "sub": "Date", "style": "almanac|almanac_sans|stone|bronze|gold|clay|neon|ice", "at": [x,z],
              "elev": m, "on": "ref:<id>|objects:N", "offset": [dx,dy,dz], "screen": 0.03, "t_in": s, "t_out": s,
              "reveal": "type|fade|rise|scale|ground"}],
  "camera": {"move": "[MOVES]",
             "speed": "slow|medium|fast", "altitude": [start_m, end_m],
             "target": "stage|ref:<id>|groups:N|objects:N|structures:N|labels:N|[x,z]",
             "side": "left|right|front|back", "passes": ["groups:0"], "end": "rise|continue|settle", "fov": 40,
             "keys": [{"t": 0, "at": [x,z], "alt": m, "look_at": [x,z], "look_h": m, "fov": 36}], "limits": "eye|macro", "strict": true,
             "lens": [{"t": 0, "fov": 40}], "dolly_zoom": {"t": [t0, t1], "fov": 24, "target": "ref:<id>"},
             "focus": [{"t": 0, "target": "ref:<id>", "fstop": 1.4}], "shake": [{"t": s, "amp": 0.6, "dur": 0.8, "freq": 8}],
             "handheld": 0.5},
  "clock": {"offset": world_s, "keys": [{"t": 0, "rate": 1}], "sync": {"t": s, "w": s}},
  "transition": {"in": "cut|warp|whiteout", "out": "cut|warp|whiteout"} }"""


def _read(name: str) -> str:
    try:
        return (HERE / name).read_text(encoding="utf-8")
    except OSError:
        return ""


def _kinds(catalog: dict) -> dict:
    return catalog.get("kinds", catalog) if isinstance(catalog, dict) else {}


def _exp(v) -> bool:
    """an engine feature marked "EXPERIMENTAL — do not use yet" in its catalog desc"""
    if isinstance(v, dict):
        v = v.get("desc", "")
    return isinstance(v, str) and v.strip().upper().startswith("EXPERIMENTAL")


def usable_kinds(catalog: dict) -> dict:
    return {k: v for k, v in _kinds(catalog).items() if not _exp(v)}


def exp_params(catalog: dict, kind: str) -> set:
    return {k for k, d in ((_kinds(catalog).get(kind) or {}).get("params") or {}).items() if _exp(d)}


def exp_camera_keys(catalog: dict) -> set:
    cam = (catalog or {}).get("camera") if isinstance(catalog, dict) else None
    return {k for k, v in (cam or {}).items() if _exp(v)}


def moves_of(catalog: dict) -> list:
    """the camera moves this engine has (its catalog), in the director's order"""
    cam = (catalog or {}).get("camera") if isinstance(catalog, dict) else None
    got = [m for m in (cam or {}).get("moves") or [] if isinstance(m, str) and m != "map_dive" and not _exp((cam or {}).get(m))]
    return list(dict.fromkeys(BASE_MOVES + got)) if got else list(BASE_MOVES)


ENGINE = HERE.parent / "engine"
_SRC = {}


def engine_src(rel: str) -> str:
    """a file of the synced engine (threed/engine/<rel>), read once"""
    if rel not in _SRC:
        try:
            _SRC[rel] = (ENGINE / rel).read_text(encoding="utf-8")
        except OSError:
            _SRC[rel] = ""
    return _SRC[rel]


def engine_min_shot() -> float:
    """the engine's shortest scene: spec.js clamps `dur` (2 s until E2 v2 allowed 1.5 s)"""
    m = re.search(r"dur\s*<\s*([0-9.]+)\s*\|\|\s*dur\s*>", engine_src("core/spec.js"))
    try:
        return max(1.0, min(3.0, float(m.group(1)))) if m else 2.0
    except ValueError:
        return 2.0


def anchor_targets() -> bool:
    """True when camera.target may name an anchor ('titanic.bow'): the engine's subjectOf resolves it"""
    src = engine_src("core/camera.js")
    a = src.find("export function subjectOf")
    if a < 0:
        return False
    b = src.find("\n}\n", a)                                    # the function's own closing brace (column 0)
    return "anchor" in src[a:b if b > 0 else a + 3000]


def has_feature(catalog: dict, need: str) -> bool:
    """`<!--needs:X-->` blocks: X = a kind (ship.iceberg), a kind prefix (fx.rocket*), ~part (a kind containing it),
    move:<name>, action:<kind>:<act>, param:<kind>:<param>, !X (only while X is missing), several joined by '+'"""
    kinds = usable_kinds(catalog)                           # EXPERIMENTAL kinds count as missing
    for one in [x.strip() for x in need.split("+") if x.strip()]:
        if "|" in one:                                       # a|b: any of them
            if not any(has_feature(catalog, alt) for alt in one.split("|") if alt.strip()):
                return False
            continue
        if one.startswith("!"):                              # shown only while the feature is missing
            if has_feature(catalog, one[1:]):
                return False
            continue
        if one.startswith("~"):                              # any kind whose name contains it
            if not any(one[1:] in k for k in kinds):
                return False
            continue
        if one.startswith("src:"):                           # src:<file under engine/>:<text in it> (a bug fix)
            _, rel, txt = (one.split(":", 2) + ["", ""])[:3]
            if not txt or txt not in engine_src(rel):
                return False
            continue
        if one.startswith("move:"):
            if one[5:] not in moves_of(catalog):
                return False
        elif one.startswith("action:"):
            _, k, a = (one.split(":") + ["", ""])[:3]
            if a not in ((kinds.get(k) or {}).get("actions") or []):
                return False
        elif one.startswith("param:"):
            _, k, p = (one.split(":") + ["", ""])[:3]
            if p not in ((kinds.get(k) or {}).get("params") or {}) or p in exp_params(catalog, k):
                return False
        elif one.endswith("*"):
            if not any(k.startswith(one[:-1]) for k in kinds):
                return False
        elif one not in kinds:
            return False
    return True


def filter_needs(text: str, catalog: dict) -> str:
    """drop the `<!--needs:X--> ... <!--/needs-->` blocks whose feature this engine does not have yet (the COOKBOOK
    documents the next engine's features before the main session syncs it; the director never sees them early)"""
    # innermost blocks first (a block holds no other opening tag), until none is left: blocks may nest
    pat = re.compile(r"<!--\s*needs:([^>]*?)\s*-->((?:(?!<!--\s*needs:).)*?)<!--\s*/needs\s*-->\n?", re.DOTALL)
    text = text or ""
    for _ in range(12):
        new = pat.sub(lambda m: m.group(2) if has_feature(catalog, m.group(1)) else "", text)
        if new == text:
            break
        text = new
    return text


def cookbook(catalog: dict) -> str:
    return filter_needs(_read("COOKBOOK.md"), catalog).replace("[MIN SHOT]", f"{engine_min_shot():g}")


NEW_MOVE_NOTES = {"fpv_dive": "fpv_dive (a steep FPV dive onto the subject)",
                  "tracking_low": "tracking_low (low and fast beside a moving subject)"}


def catalog_text(catalog: dict, limit: int = 60000) -> str:
    """one line per kind: name — desc [actions] {params}. The limit must hold EVERY kind (it was 16000 chars: 72 of 176
    kinds — ships, the iceberg, space, towns, landmarks, props — never reached the director)"""
    kinds = usable_kinds(catalog)
    rows = []
    for k in sorted(kinds):
        v = kinds[k] if isinstance(kinds[k], dict) else {}
        acts = ",".join(v.get("actions", [])[:10])
        params = ",".join([x for x, d in (v.get("params") or {}).items() if not _exp(d)][:12])
        rows.append(f"{k} — {str(v.get('desc', ''))[:100]}" + (f" [{acts}]" if acts else "") + (f" {{{params}}}" if params else ""))
    return "\n".join(rows)[:limit]


def moves_doc(catalog: dict) -> str:
    """the engine's own docs of its camera moves (catalog["camera"][<move>]: E4's space moves carry their params there —
    without them the director filmed 6,720 m planets with generic orbits and the camera lost them)"""
    cam = (catalog or {}).get("camera") if isinstance(catalog, dict) else None
    rows = []
    for m in moves_of(catalog):
        doc = (cam or {}).get(m)
        if isinstance(doc, str) and doc.strip() and not _exp(doc):
            rows.append(f"{m}: {doc.strip()}")
    return "\n".join(rows)


def _moment_words(m: dict) -> str:
    """a moment's words with their start times (the director cuts on words); falls back to the plain text"""
    ws = m.get("words") or []
    if not ws:
        return "    " + m.get("text", "")
    out, line = [], "   "
    for w in ws:
        tok = f" {float(w[1]):.1f} {w[0]}"
        if len(line) + len(tok) > 116:
            out.append(line)
            line = "   "
        line += tok
    out.append(line)
    return "\n".join(out)


def build_prompt(title: str, lines: list, moments: list, catalog: dict, language_line: str,
                 context: str = "", section: str = "") -> str:
    tpl = filter_needs(_read("prompt.md"), catalog)
    ln = "\n".join(f"{a:7.1f}-{b:6.1f} {txt}" for a, b, txt in lines)
    mo = "\n".join(f"{m['id']}: {m['t0']:.1f}-{m['t1']:.1f} ({m['t1'] - m['t0']:.1f} s, >= "
                   f"{shots_needed(m['t1'] - m['t0'])} shots)\n{_moment_words(m)}" for m in moments)
    moves = moves_of(catalog)
    extra = [NEW_MOVE_NOTES.get(x, x) for x in moves if x not in BASE_MOVES]
    tpl = tpl.replace("[MIN SHOT]", f"{engine_min_shot():g}")
    tpl = tpl.replace("[FPV MOVES]", " / ".join(f"`{m}`" for m in FPV if m in moves)) \
             .replace("[DRONE MOVES]", ", ".join(f"`{m}`" for m in DRONE if m in moves))
    return (tpl.replace("[LANGUAGE LINE]", language_line).replace("[TITLE]", title)
            .replace("[SPEC]", SPEC_DOC.replace("[MOVES]", "|".join(moves)))
            .replace("[NEW MOVES]", ", ".join(extra) if extra else "and `keys` for a designed path")
            .replace("[MONEY KIT]", "").replace("[COOKBOOK]", cookbook(catalog))
            .replace("[CATALOG]", catalog_text(catalog) + ("\n\nCAMERA MOVES — the engine's own docs (use these params):\n"
                                                         + moves_doc(catalog) if moves_doc(catalog) else ""))
            .replace("[SECTION]", section or "the whole video").replace("[CONTEXT]", context or "(none)")
            .replace("[LINES]", ln[:60000]).replace("[MOMENTS]", mo))


def shots_needed(length: float) -> int:
    return max(1, int(math.ceil(length / SECONDS_PER_SHOT - 1e-6)))


def _json_fix(txt: str) -> str:
    """the usual syntax slips of a long generated JSON: trailing commas, a missing comma between objects / arrays /
    values on separate lines"""
    t = re.sub(r",\s*([}\]])", r"\1", txt)
    t = re.sub(r"}\s*{", "}, {", t)
    t = re.sub(r"]\s*\[", "], [", t)
    t = re.sub(r'(["}\]0-9el])\s*\n(\s*")', r"\1,\n\2", t)
    return t


def _json_object(raw: str):
    raw = raw or ""
    m = re.search(r"\{.*\}", raw, re.DOTALL)
    if not m:
        raise ValueError("no JSON object in the reply")
    txt = m.group(0)
    try:
        return json.loads(txt)
    except json.JSONDecodeError:
        try:
            return json.loads(_json_fix(txt))
        except json.JSONDecodeError:
            pass
        # a trailing remark after the object: cut at the last brace that parses
        for end in range(len(txt), 0, -1):
            if txt[end - 1] == "}":
                try:
                    return json.loads(txt[:end])
                except json.JSONDecodeError:
                    continue
        raise


def _nearest(name, pool: list, default: str):
    name = str(name or "")
    if name in pool:
        return name, None
    hit = difflib.get_close_matches(name, pool, n=1, cutoff=0.4)
    return (hit[0], f"{name} -> {hit[0]}") if hit else (default, f"{name} -> {default}")


def _num(v, default: float) -> float:
    try:
        f = float(v)
        return f if math.isfinite(f) else default
    except (TypeError, ValueError):
        return default


def scale_of(s: dict) -> str:
    raw = str(s.get("scale") or "").strip().lower().replace("-", "_")
    raw = SCALE_ALIASES.get(raw, raw)
    return raw if raw in SCALES else ""


def render_spec(s: dict) -> dict:
    """the scene as the engine gets it: the director's notes (scale, beat) stay in the board"""
    out = json.loads(json.dumps(s))
    for k in DIRECTOR_KEYS:
        out.pop(k, None)
    return out


def clean_scene(s: dict, kinds: dict, cast_ids: set, biomes: list, warn: list, moves: list = None,
                catalog: dict = None) -> dict:
    """fix one scene spec in place so the engine can load it; unknown kinds become the nearest catalog kind; an
    EXPERIMENTAL kind is dropped, an EXPERIMENTAL param or camera key is removed"""
    moves = moves or MOVES
    exp_k = {k for k, v in kinds.items() if _exp(v)}
    kinds = {k: v for k, v in kinds.items() if k not in exp_k}
    kind_names = list(kinds)
    sid = s.get("id")
    cam = s.setdefault("camera", {})
    if not isinstance(cam, dict):
        cam = s["camera"] = {}
    for key in exp_camera_keys(catalog or {}) & set(cam):
        warn.append(f"{sid} camera.{key} is experimental in this engine — removed")
        cam.pop(key, None)
    cam["move"], w = _nearest(cam.get("move", "fpv_flythrough"), moves, "fpv_flythrough")
    if w: warn.append(f"{sid} camera {w}")
    # camera.target takes whole items only (engine subjectOf): an anchor ('titanic.bow', 'objects:0.bow') falls back
    # to the stage — aim at its ship instead
    tg = cam.get("target")
    if isinstance(tg, str) and "." in tg and not tg.startswith("ref:") and not anchor_targets():
        head = tg.split(".", 1)[0]
        objs = s.get("objects") or []
        k = next((i for i, o in enumerate(objs) if isinstance(o, dict) and (o.get("id") == head or f"objects:{i}" == head)),
                 None)
        if k is not None:
            cam["target"] = f"objects:{k}"
            warn.append(f"{sid} camera.target {tg} -> objects:{k} (anchors are not camera targets; aim keys look_at there)")
    if cam["move"] == "keys" and not (isinstance(cam.get("keys"), list) and len(cam["keys"]) >= 2):
        cam["move"] = "push_in"
        warn.append(f"{sid} keys move without two keys -> push_in")
    look = s.setdefault("look", {})
    if not isinstance(look, dict):
        look = s["look"] = {}
    look["time"], _ = _nearest(look.get("time", "morning"), TIMES, "morning")
    look["sky"], _ = _nearest(look.get("sky", "scattered"), SKIES, "scattered")
    if "grade" in look:
        look["grade"], _ = _nearest(look.get("grade"), GRADES, "neutral")
    world = s.setdefault("world", {})
    if not isinstance(world, dict):
        world = s["world"] = {}
    world["biome"], w = _nearest(str(world.get("biome", biomes[0])).replace("biome.", ""), biomes, biomes[0])
    if w: warn.append(f"{sid} biome {w}")
    for sec in ("groups", "objects", "structures"):
        keep = []
        for it in s.get(sec, []) or []:
            if not isinstance(it, dict) or not it.get("kind"):
                continue
            if it["kind"] in exp_k:
                warn.append(f"{sid} dropped {it['kind']}: experimental in this engine")
                continue
            k, w = _nearest(it["kind"], kind_names, "")
            if not k:
                warn.append(f"{sid} dropped an unknown {sec[:-1]} {it.get('kind')}")
                continue
            it["kind"] = k
            if w: warn.append(f"{sid} {sec} {w}")
            for prm in exp_params(catalog or {}, k):
                if prm in it or prm in (it.get("params") or {}):
                    it.pop(prm, None)
                    (it.get("params") or {}).pop(prm, None)
                    warn.append(f"{sid} {k}.{prm} is experimental in this engine — removed")
            acts = (kinds.get(k) or {}).get("actions") or []
            if acts and it.get("action") and it["action"] not in acts:
                a, _ = _nearest(it["action"], acts, acts[0])
                warn.append(f"{sid} {k} has no action '{it['action']}' -> {a}")
                it["action"] = a
            if sec == "groups":
                it["count"] = max(1, min(3000, int(_num(it.get("count"), 20))))
            keep.append(it)
        s[sec] = keep
    # interiors are closed sets (Robin: "water in the room with the guy"): never on a sea world
    if any(str(it.get("kind", "")).startswith("interior.") for it in s["structures"]) and world["biome"] in SEA_BIOMES:
        warn.append(f"{sid} interior on the {world['biome']} world -> {INTERIOR_WORLD['biome']} (closed set)")
        world.pop("coast", None)
        world.update(INTERIOR_WORLD)
    cast_acts = (kinds.get("cast") or {}).get("actions") or []
    keep = []
    for c in s.get("cast", []) or []:
        if not (isinstance(c, dict) and c.get("ref") in cast_ids):
            continue
        for holder in [c] + [a for a in (c.get("actions") or []) if isinstance(a, dict)]:
            if cast_acts and holder.get("action") and holder["action"] not in cast_acts:
                a, _ = _nearest(holder["action"], cast_acts, "idle")
                warn.append(f"{sid} {c['ref']} has no action '{holder['action']}' -> {a}")
                holder["action"] = a
        keep.append(c)
    s["cast"] = keep
    labels = []
    for lb in s.get("labels", []) or []:
        if not isinstance(lb, dict) or not str(lb.get("text", "")).strip():
            continue
        lb["style"], _ = _nearest(lb.get("style", "almanac"), LABEL_STYLES, "almanac")
        lb["text"] = str(lb["text"])[:40]
        if lb["style"] not in STORY_LABELS:
            lb["text"] = lb["text"][:28].upper()
        labels.append(lb)
    s["labels"] = labels[:2]
    tr = s.setdefault("transition", {})
    if not isinstance(tr, dict):
        tr = s["transition"] = {}
    for side in ("in", "out"):
        tr[side], _ = _nearest(tr.get(side, "cut"), TRANSITIONS, "cut")
    # a dissolve is made by the assembly between two shots of one moment (then/now): pair_dissolves() checks it
    sc = scale_of(s)
    if sc:
        s["scale"] = sc
    else:
        s.pop("scale", None)
    s.pop("version", None)
    return s


SIGNATURES = ("sash", "armband", "medals", "epaulettes", "scarf")


def clean_cast(cast: list) -> list:
    """CastDefs the engine can dress: `signature` keeps only the engine's named details (anything else is a warning)"""
    out = []
    for c in cast or []:
        if not isinstance(c, dict) or not c.get("id"):
            continue
        sig = [w for w in re.split(r"[ ,+]+", str(c.get("signature") or "").lower()) if w in SIGNATURES]
        if sig:
            c["signature"] = " ".join(dict.fromkeys(sig))
        else:
            c.pop("signature", None)
        out.append(c)
    return out


# ── geometry of a spec (no engine: flat ground, straight-line motion) — enough to measure a keys camera ───────────────
def _dirv(h: float) -> tuple:
    return math.sin(math.radians(h)), -math.cos(math.radians(h))


def _xz(v):
    if isinstance(v, (list, tuple)) and len(v) >= 2:
        return float(_num(v[0], 0)), float(_num(v[-1] if len(v) == 2 else v[2], 0))
    return 0.0, 0.0


def _along(path: list, dist: float) -> tuple:
    pts = [_xz(p) for p in path if isinstance(p, (list, tuple)) and len(p) >= 2]
    if not pts:
        return 0.0, 0.0
    for a, b in zip(pts, pts[1:]):
        seg = math.hypot(b[0] - a[0], b[1] - a[1])
        if dist <= seg and seg > 1e-6:
            u = dist / seg
            return a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u
        dist -= seg
    return pts[-1]


def item_pos(it: dict, t: float) -> tuple:
    """where a cast/object item is at scene time t (straight-line approximation of its motion)"""
    speed = _num(it.get("speed"), 0.0)
    start = _num(it.get("start"), 0.0)
    tt = max(0.0, t - start)
    if isinstance(it.get("path"), list) and len(it["path"]) >= 2 and speed > 0:
        return _along(it["path"], speed * tt)
    x, z = _xz(it.get("at") or [0, 0])
    act = str(it.get("action") or "")
    if speed > 0 and act in ("sail", "drive", "fly", "walk", "run", "sprint", "march", "move"):
        dx, dz = _dirv(_num(it.get("heading"), 0.0))
        return x + dx * speed * tt, z + dz * speed * tt
    return x, z


# the liner's deck points (titanic.js anchors): metres forward of midship, metres to port, height above the sea
LINER_ANCHORS = {"bow": (130.5, 0, 15.0), "forecastle": (114.5, 0, 15.0), "crows_nest": (94.0, 0, 30.2),
                 "bridge": (72.7, 0, 20.0), "bridge_wing": (73.5, 14.3, 19.7), "bridge_wing_starboard": (73.5, -14.3, 19.7),
                 "well_deck": (88.5, 0, 11.0), "boat_deck": (14.5, 11.0, 19.8), "boat_deck_starboard": (14.5, -11.0, 19.8),
                 "stern_deck": (-120.5, 0, 14.0), "stern": (-131.5, 0, 13.5), "midship": (0, 0, 10.0)}


def anchor_pos(s: dict, ref: str, t: float):
    """(x, y, z) of a liner deck point '<id>.<anchor>' / 'objects:N.<anchor>' at time t (straight-line motion), or None"""
    m = re.match(r"^(.+)\.([a-z_0-9]+)$", str(ref or ""))
    if not m:
        return None
    objs = s.get("objects") or []
    head, name = m.group(1), m.group(2)
    mo = re.match(r"objects:(\d+)$", head)
    ship = objs[int(mo.group(1))] if mo and int(mo.group(1)) < len(objs) else next(
        (o for o in objs if isinstance(o, dict) and o.get("id") == head), None)
    if not ship or name not in LINER_ANCHORS or str(ship.get("kind")) != "ship.liner_1912":
        return None
    k = _num(ship.get("length"), 269.0) / 269.0
    fwd, port, y = LINER_ANCHORS[name]
    x0, z0 = item_pos(ship, t)
    h = _num(ship.get("heading"), 0.0)
    fx, fz = _dirv(h)
    px, pz = _dirv(h - 90)
    return x0 + fx * fwd * k + px * port, y * math.sqrt(k), z0 + fz * fwd * k + pz * port


def target_of(s: dict, ref, t: float):
    """(x, y, z, item, section) of a camera target at time t, or None"""
    if isinstance(ref, (list, tuple)) and len(ref) >= 2:
        x, z = _xz(ref)
        return x, 1.2, z, None, "point"
    ref = str(ref or "stage")
    if ref == "stage":
        return 0.0, 1.2, 0.0, None, "stage"
    m = re.match(r"(objects|structures|groups|labels):(\d+)", ref)
    if m:
        sec, k = m.group(1), int(m.group(2))
        lst = s.get(sec) or []
        if k < len(lst) and isinstance(lst[k], dict):
            it = lst[k]
            x, z = item_pos(it, t)
            kind = str(it.get("kind", ""))
            y = 12.0 if kind == "ship.liner_1912" else 1.0 if sec == "groups" else 2.0
            return x, y, z, it, sec
        return None
    if ref.startswith("ref:"):
        for c in s.get("cast") or []:
            if c.get("ref") == ref[4:]:
                place = c.get("on") if isinstance(c.get("on"), str) else c.get("at") if isinstance(c.get("at"), str) else None
                if place and place != "stage":                # a person on a ship's deck point
                    ap = anchor_pos(s, place, t)
                    if ap:
                        return ap[0], ap[1] - 0.6, ap[2], c, "cast"
                x, z = item_pos(c, t)
                return x, 1.1, z, c, "cast"
    ap = anchor_pos(s, ref, t)
    if ap:
        return ap[0], ap[1], ap[2], None, "anchor"
    return None


def _key_cam(k: dict, s: dict, cam: dict, t: float):
    """(pos, look, fov) of one camera key; look defaults to the target"""
    if isinstance(k.get("pos"), (list, tuple)) and len(k["pos"]) >= 3:
        pos = tuple(_num(v, 0) for v in k["pos"][:3])
    else:
        x, z = _xz(k.get("at") or [0, 0])
        pos = (x, _num(k.get("alt"), 2.0), z)
    if isinstance(k.get("look"), (list, tuple)) and len(k["look"]) >= 3:
        look = tuple(_num(v, 0) for v in k["look"][:3])
    elif isinstance(k.get("look_at"), (list, tuple)) and len(k["look_at"]) >= 2:
        x, z = _xz(k["look_at"])
        look = (x, _num(k.get("look_h"), 1.5), z)
    else:
        tg = target_of(s, cam.get("target"), t)
        look = (tg[0], tg[1], tg[2]) if tg else (0.0, 1.2, 0.0)
    return pos, look, _num(k.get("fov"), _num(cam.get("fov"), 40.0))


def _sub(a, b):
    return a[0] - b[0], a[1] - b[1], a[2] - b[2]


def _norm(a):
    return math.sqrt(a[0] ** 2 + a[1] ** 2 + a[2] ** 2)


def _angle(a, b) -> float:
    na, nb = _norm(a), _norm(b)
    if na < 1e-6 or nb < 1e-6:
        return 0.0
    c = max(-1.0, min(1.0, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (na * nb)))
    return math.degrees(math.acos(c))


def _project(pos, look, fov, p):
    """normalised screen coordinates (x right, y up, -1..1) of a world point, or None behind the camera"""
    f = _sub(look, pos)
    fl = _norm(f) or 1.0
    f = (f[0] / fl, f[1] / fl, f[2] / fl)
    r = (f[1] * 0 - f[2] * 1, f[2] * 0 - f[0] * 0, f[0] * 1 - f[1] * 0)      # f x up(0,1,0)
    rl = _norm(r) or 1.0
    r = (r[0] / rl, r[1] / rl, r[2] / rl)
    u = (r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0])
    v = _sub(p, pos)
    zc = v[0] * f[0] + v[1] * f[1] + v[2] * f[2]
    if zc <= 0.1:
        return None
    th = math.tan(math.radians(fov) / 2)
    return ((v[0] * r[0] + v[1] * r[1] + v[2] * r[2]) / (zc * th * ASPECT),
            (v[0] * u[0] + v[1] * u[1] + v[2] * u[2]) / (zc * th))


def _keys_sorted(cam: dict, dur: float) -> list:
    ks = [k for k in cam.get("keys") or [] if isinstance(k, dict)]
    n = len(ks)
    out = []
    for i, k in enumerate(ks):
        t = _num(k.get("t"), dur * i / max(1, n - 1))
        out.append((max(0.0, min(dur, t)), k))
    return sorted(out, key=lambda x: x[0])


def camera_metrics(s: dict) -> dict:
    """how much a keys camera changes over the shot: subject size (zoom), angle around the look point (arc), view
    direction (pan), travel; its kind of motion; the hero's size in frame. Templates move by design."""
    cam = s.get("camera") or {}
    move = cam.get("move") or "fpv_flythrough"
    dur = _num(s.get("dur"), 4.0)
    out = {"move": move, "kind": move}
    if move != "keys":
        return out
    ks = _keys_sorted(cam, dur)
    if len(ks) < 2:
        return out
    (t0, k0), (t1, k1) = ks[0], ks[-1]
    p0, l0, f0 = _key_cam(k0, s, cam, t0)
    p1, l1, f1 = _key_cam(k1, s, cam, t1)
    # the subject: the camera's target where it is at each key (a sailing ship comes closer), else the look point
    tg0, tg1 = target_of(s, cam.get("target"), t0), target_of(s, cam.get("target"), t1)
    c0 = (tg0[0], tg0[1], tg0[2]) if tg0 and cam.get("target") not in (None, "stage") else l0
    c1 = (tg1[0], tg1[1], tg1[2]) if tg1 and cam.get("target") not in (None, "stage") else l1
    d0, d1 = max(0.3, _norm(_sub(c0, p0))), max(0.3, _norm(_sub(c1, p1)))
    zoom = (d0 / d1) * (math.tan(math.radians(f0) / 2) / max(1e-3, math.tan(math.radians(f1) / 2)))
    arc = _angle(_sub(p0, c0), _sub(p1, c1))
    pan = _angle(_sub(l0, p0), _sub(l1, p1))
    # the path's own bends (a 3-key arc returns to its start direction but still moved)
    travel = sum(_norm(_sub(_key_cam(b, s, cam, tb)[0], _key_cam(a, s, cam, ta)[0])) for (ta, a), (tb, b) in zip(ks, ks[1:]))
    for (ta, a) in ks[1:-1]:
        pm, lm, _ = _key_cam(a, s, cam, ta)
        pan = max(pan, _angle(_sub(l0, p0), _sub(lm, pm)))
        arc = max(arc, _angle(_sub(p0, c0), _sub(pm, c0)))
    scale_k = max(1.0, dur / 4.0)
    need_z, need_a, need_p = ZOOM_MIN * scale_k, ARC_MIN * scale_k, PAN_MIN * scale_k
    zs, as_, ps = abs(math.log(max(1e-3, zoom))) / math.log(1 + need_z), arc / need_a, pan / need_p
    rise = (p1[1] - p0[1])
    best = max(zs, as_, ps)
    if best < 1.0:
        kind = "still" if best < 0.34 else "static"
    elif best == zs:
        kind = "push" if zoom > 1 else "pull"
    elif best == as_:
        kind = ("rise" if rise > 0 else "drop") if abs(rise) > 0.5 * max(1.0, math.hypot(p1[0] - p0[0], p1[2] - p0[2])) else "arc"
    else:
        kind = "pan"
    out.update({"kind": f"keys:{kind}", "zoom": round(zoom, 3), "arc": round(arc, 1), "pan": round(pan, 1),
                "travel": round(travel, 1), "dist": [round(d0, 1), round(d1, 1)], "motion": round(best, 2)})
    # the hero's size in frame (character shots and ship hero shots)
    tg = cam.get("target")
    sizes = []
    for (t, k) in (ks[0], ks[-1]):
        p, l, f = _key_cam(k, s, cam, t)
        tp = target_of(s, tg, t)
        if not tp:
            continue
        d = max(0.3, _norm(_sub((tp[0], tp[1], tp[2]), p)))
        if tp[4] == "cast":
            h = 1.8 * _num(((tp[3] or {}).get("build") or {}).get("height"), 1.0)
            sizes.append(("person_h", h / (2 * d * math.tan(math.radians(f) / 2))))
        elif tp[3] and str(tp[3].get("kind", "")) in SIZES:
            L, B = SIZES[str(tp[3]["kind"])]
            hx, hz = _dirv(_num(tp[3].get("heading"), 0.0))
            v = _sub((tp[0], tp[1], tp[2]), p)
            vl = math.hypot(v[0], v[2]) or 1.0
            cosang = abs((hx * v[0] + hz * v[2]) / vl)
            proj = L * math.sqrt(max(0.0, 1 - cosang ** 2)) + B * cosang
            hfov = 2 * math.atan(math.tan(math.radians(f) / 2) * ASPECT)
            sizes.append(("ship_w", proj / (2 * d * math.tan(hfov / 2))))
    if sizes:
        out["hero"] = sizes[0][0]
        out["hero_frac"] = round(max(v for _, v in sizes), 3)
    return out


def label_positions(s: dict) -> list:
    """(label index, screen x, screen y) of story labels that stand at a fixed place, sampled over their life (reveal
    +0.6 s, middle, end), for keys cameras"""
    cam = s.get("camera") or {}
    if cam.get("move") != "keys":
        return []
    dur = _num(s.get("dur"), 4.0)
    ks = _keys_sorted(cam, dur)
    if len(ks) < 2:
        return []
    out = []
    for i, lb in enumerate(s.get("labels") or []):
        if lb.get("on") or not isinstance(lb.get("at"), (list, tuple)):
            continue
        t_in = min(dur, _num(lb.get("t_in"), 0.0) + 0.6)
        t_out = min(dur, _num(lb.get("t_out"), dur))
        for t in sorted({round(t_in, 2), round((t_in + max(t_in, t_out)) / 2, 2), round(max(t_in, t_out - 0.1), 2)}):
            sp = _label_at(s, cam, ks, lb, t)
            if sp:
                out.append((i, round(sp[0], 2), round(sp[1], 2)))
    return out


def _label_at(s: dict, cam: dict, ks: list, lb: dict, t: float):
    """screen (x, y) of a fixed label at time t under a keys camera (linear between the keys around t)"""
    prev, nxt = ks[0], ks[-1]
    for a, b in zip(ks, ks[1:]):
        if a[0] <= t <= b[0]:
            prev, nxt = a, b
            break
    pa, la, fa = _key_cam(prev[1], s, cam, prev[0])
    pb, lb_, fb = _key_cam(nxt[1], s, cam, nxt[0])
    u = 0.0 if nxt[0] <= prev[0] else (t - prev[0]) / (nxt[0] - prev[0])
    pos = tuple(pa[j] + (pb[j] - pa[j]) * u for j in range(3))
    look = tuple(la[j] + (lb_[j] - la[j]) * u for j in range(3))
    x, z = _xz(lb["at"])
    return _project(pos, look, fa + (fb - fa) * u, (x, _num(lb.get("elev"), 2.0), z))


def path_turns(it: dict) -> float:
    """the sharpest heading change at a corner of an item's path (deg)"""
    pts = [_xz(p) for p in it.get("path") or [] if isinstance(p, (list, tuple)) and len(p) >= 2]
    worst = 0.0
    for a, b, c in zip(pts, pts[1:], pts[2:]):
        h1 = math.degrees(math.atan2(b[0] - a[0], -(b[1] - a[1])))
        h2 = math.degrees(math.atan2(c[0] - b[0], -(c[1] - b[1])))
        worst = max(worst, abs((h2 - h1 + 540) % 360 - 180))
    return worst


SEATED = ("sit", "sit_ground")
STAND_UP = ("stand", "stand_up", "get_up", "rise", "attention", "walk", "run", "sprint", "march", "ride", "cheer",
            "take_cover", "struck_fall", "lie_back", "enter", "ski", "dig", "cpr")
_POSTURE = []


def posture_engine() -> bool:
    """True when the engine keeps a seated figure seated through upper-body actions (E1, Frontier 3D v2: look_up,
    speak, point, watch, wave play as seated variants; only an explicit stand or a whole-body action stands it up)"""
    if not _POSTURE:
        try:
            src = (HERE.parent / "engine" / "lib" / "human" / "cast.js").read_text(encoding="utf-8")
            _POSTURE.append("STAND_WORDS" in src and "seatOverlay" in src)
        except OSError:
            _POSTURE.append(False)
    return _POSTURE[0]
# furniture of the rooms at heading 0 (local x east, z south; engine/lib/human/interiors.js): name, centre, size x, z
FURNITURE = {"interior.study": [("the desk", 0.3, -0.6, 1.6, 0.8), ("the armchair", -1.1, 1.4, 0.95, 0.95),
                                ("the fireplace", 0.0, 2.95, 1.6, 0.5), ("the bookshelves", -2.3, 0.05, 0.35, 4.6)],
             "interior.office": [("the desk", 0.3, -0.6, 1.6, 0.8), ("the bookshelves", -2.3, -1.8, 0.35, 1.4),
                                 ("the filing cabinets", -2.2, 2.3, 0.5, 1.2)]}
TALL = ("the bookshelves",)     # solids over 1.8 m: the engine keeps the camera 0.6 m from them (and from the walls)
QA_MARGIN = 0.65


def _room_local(st: dict, x: float, z: float) -> tuple:
    """a world point in the room's own frame (the room turns by -heading: interiors.js place.rotation.y)"""
    ax, az = _xz(st.get("at") or [0, 0])
    h = math.radians(_num(st.get("heading"), 180.0))
    dx, dz = x - ax, z - az
    # world = R(-h) local  ->  local = R(h) world, with three.js y-rotation x' = x cos + z sin, z' = -x sin + z cos
    return dx * math.cos(h) + dz * math.sin(h), -dx * math.sin(h) + dz * math.cos(h)


def room_checks(s: dict) -> list:
    """figures inside the furniture or the walls of a known room; a camera key outside the room"""
    v = []
    kinds_fp = {"interior.study": (5, 6.5), "interior.office": (5, 7), "interior.cellar": (4, 6), "interior.bunker": (4, 6),
                "interior.storm_cellar": (3, 5.6), "interior.small_room": (2.2, 5.4), "interior.cell": (3.7, 4.2),
                "interior.palace_hall": (14, 34)}
    for st in s.get("structures") or []:
        k = str(st.get("kind", ""))
        if k not in kinds_fp:
            continue
        W, L = kinds_fp[k]
        who = [(f"{c.get('ref')}", c) for c in s.get("cast") or []]
        for name, c in who:
            lx, lz = _room_local(st, *_xz(c.get("at") or [0, 0]))
            if abs(lx) > W / 2 - 0.3 or abs(lz) > L / 2 - 0.3:
                v.append(f"figure_in_wall: {name} at {c.get('at')} is outside or inside the walls of {k} "
                         f"({W} x {L} m around {st.get('at')})")
                continue
            for fname, cx, cz, fw, fd in FURNITURE.get(k, []):
                if abs(lx - cx) < fw / 2 + 0.05 and abs(lz - cz) < fd / 2 + 0.05:
                    v.append(f"figure_in_furniture: {name} at {c.get('at')} stands inside {fname} of {k} — see the "
                             f"COOKBOOK's room layout (seated at the desk: [0.3, 0.15], heading 0, room heading 0)")
        cam = s.get("camera") or {}
        if cam.get("move") == "keys":
            for kk in cam.get("keys") or []:
                if not isinstance(kk, dict):
                    continue
                if isinstance(kk.get("pos"), (list, tuple)) and len(kk["pos"]) >= 3:
                    px, pz = _num(kk["pos"][0], 0), _num(kk["pos"][2], 0)
                else:
                    px, pz = _xz(kk.get("at") or [0, 0])
                lx, lz = _room_local(st, px, pz)
                if abs(lx) > W / 2 - 0.1 or abs(lz) > L / 2 - 0.1:
                    v.append(f"camera_outside_room: a camera key at [{px:.1f}, {pz:.1f}] is outside {k} ({W} x {L} m) — "
                             f"it films the back of the walls")
                    break
                near = [f for f in FURNITURE.get(k, []) if f[0] in TALL and abs(lx - f[1]) < f[3] / 2 + QA_MARGIN
                        and abs(lz - f[2]) < f[4] / 2 + QA_MARGIN]
                if abs(lx) > W / 2 - QA_MARGIN or abs(lz) > L / 2 - QA_MARGIN or near:
                    what = near[0][0] if near else "a wall"
                    v.append(f"camera_in_solid: a camera key at [{px:.1f}, {pz:.1f}] is within 0.6 m of {what} of {k} — "
                             f"the engine lifts it through the ceiling; see the COOKBOOK's free space")
                    break
        elif k.startswith("interior."):
            v.append(f"interior_move: {cam.get('move')} in {k} flies out of the room — use keys at eye level")
    return v


def engine_features(catalog: dict) -> dict:
    """what the engine behind this catalog already does by itself (so the checks don't flag it)"""
    return {"smooth_paths": has_feature(catalog or {}, "nature.iceberg"),       # E2: paths filleted by turn radius
            "wind_sea": has_feature(catalog or {}, "nature.iceberg")}           # E1/E2: sea state follows the wind


def scene_checks(s: dict, feats: dict = None, money: set = None) -> tuple:
    """-> (metrics, [violation strings]) of one scene against the v2 grammar"""
    feats = feats or {}
    money = money or set()
    v = []
    dur = _num(s.get("dur"), 4.0)
    met = camera_metrics(s)
    met["dur"] = round(dur, 2)
    met["scale"] = scale_of(s) or "?"
    if dur > MAX_SHOT + 0.05:
        v.append(f"shot_long: {dur:.1f} s is over the {MAX_SHOT:.0f} s maximum — split it into 2-3 shots")
    if not scale_of(s):
        v.append("no_scale: declare the shot scale (extreme_wide|wide|medium|close|insert)")
    kind = met.get("kind", "")
    if kind in ("keys:static", "keys:still") and not (kind == "keys:still" and dur <= STILL_MAX):
        v.append(f"static_camera: the keys barely move (size x{met.get('zoom', 1):.2f}, arc {met.get('arc', 0):.0f}°, "
                 f"view {met.get('pan', 0):.0f}° over {dur:.1f} s) — push >= {int(ZOOM_MIN * 100 * max(1, dur / 4))} %, "
                 f"or arc/pan >= {ARC_MIN * max(1, dur / 4):.0f}°, or use a move template")
    frac = met.get("hero_frac")
    sc = scale_of(s)
    if frac is not None and met.get("hero") == "person_h" and sc in ("medium", "close", "insert") and frac < PERSON_MIN_FRAC:
        v.append(f"subject_small: the person is {100 * frac:.0f} % of the frame height in a {sc} shot (>= "
                 f"{100 * PERSON_MIN_FRAC:.0f} %): closer or a longer lens")
    if frac is not None and met.get("hero") == "ship_w" and (sc == "wide" or s.get("id") in money) and frac < SHIP_MIN_FRAC:
        v.append(f"subject_small: the ship fills {100 * frac:.0f} % of the frame width (hero shots >= "
                 f"{100 * SHIP_MIN_FRAC:.0f} %): closer, or fov 20-30")
    world = s.get("world") or {}
    if str(world.get("biome", "")) in SEA_BIOMES and "wind" not in (s.get("weather") or {}) \
            and not any(str(it.get("kind", "")).startswith("interior.") for it in s.get("structures") or []):
        v.append("sea_state: a sea scene without weather.wind — set it (0 glassy calm, 0.35 gentle, 0.5 chop, 1 storm; "
                 "the Titanic night is 0)")
    if any(str(it.get("kind", "")).startswith("interior.") for it in s.get("structures") or []) \
            and str(world.get("biome", "")) in SEA_BIOMES:
        v.append("interior_water: an interior on a sea world shows water in the room — use a land world")
    for c in s.get("cast") or []:
        acts = [c.get("action")] + [a.get("action") for a in c.get("actions") or [] if isinstance(a, dict)]
        acts = [a for a in acts if a]
        if any(a in SEATED for a in acts):
            # E1's engine keeps a seated figure seated through upper-body actions; the older one stands it up for any
            standing = [a for a in acts if a not in SEATED and (a in STAND_UP or not posture_engine())]
            if standing:
                v.append(f"seated_stands: {c.get('ref')} sits and then does {', '.join(standing)} — the figure stands "
                         f"up where it sits (inside the desk or chair); keep one posture per shot, cut to show him rise")
    for sec in ("objects", "groups"):
        for i, it in enumerate(s.get(sec) or []):
            k = str(it.get("kind", ""))
            lim = SHIP_TURN_MAX if k.startswith("ship.") else VEHICLE_TURN_MAX if k.startswith(("vehicle.", "aircraft.")) else None
            if lim and isinstance(it.get("path"), list) and len(it["path"]) >= 3 and not feats.get("smooth_paths"):
                turn = path_turns(it)
                if turn > lim:
                    v.append(f"heading_snap: {sec}:{i} ({k}) turns {turn:.0f}° at one path point (max {lim:.0f}°) — "
                             f"more points on a wide arc")
    v += room_checks(s)
    cam = s.get("camera") or {}
    tg = cam.get("target")
    things = [o for o in s.get("objects") or [] if not str(o.get("kind", "")).startswith(("space.starfield", "water."))]
    if (tg in (None, "", "stage") or isinstance(tg, (list, tuple))) and not _interior(s):
        v.append("no_hero: the camera has no hero — name it as camera.target (a person, the ship, the boat, the berg, "
                 "the prop); an empty sea is not a shot" + ("" if (s.get("cast") or s.get("groups") or things) else
                                                            " and there is nothing in it"))
    head = str(tg or "").split(".")[0] if isinstance(tg, str) else ""
    mo = re.match(r"objects:(\d+)$", head)
    objs = s.get("objects") or []
    ship = objs[int(mo.group(1))] if mo and int(mo.group(1)) < len(objs) else next(
        (o for o in objs if isinstance(o, dict) and head and o.get("id") == head), None)
    if ship and str(ship.get("action")) == "sink" and str(ship.get("final", "under")) == "under":
        sk = dict(ship.get("sink") or {}, **{k: ship[k] for k in ("t0", "dur") if k in ship})
        gone = _num(sk.get("t0"), 0.0) + 0.97 * _num(sk.get("dur"), 20.0)
        w0 = _num((s.get("clock") or {}).get("offset"), 0.0)
        if w0 >= gone:
            v.append(f"no_hero: the camera looks at {tg}, but she is already under water by world time {w0:.0f} s "
                     f"(her sink ends at {gone:.0f} s) — an empty sea; aim at what is left (the boats, the people, the "
                     f"wreckage) or start the world earlier")
    details = [o for o in s.get("objects") or [] if str(o.get("kind", "")).startswith("detail.")]
    if scale_of(s) == "insert" and len(details) > 1:
        v.append(f"insert_crowded: {len(details)} details in one insert — one idea per insert, its readable face big")
    seen_lb = set()
    for i, x, y in label_positions(s):
        if i in seen_lb:
            continue
        top = 100 * (1 - (y + 1) / 2)
        if y < -0.5:
            seen_lb.add(i)
            v.append(f"label_low: labels:{i} reaches {top:.0f} % from the top — in the caption zone; raise it (elev) "
                     f"or aim the camera lower")
        elif y > 0.72 or abs(x) > 0.85:
            seen_lb.add(i)
            v.append(f"label_edge: labels:{i} drifts to the frame edge ({top:.0f} % from the top, x {x:+.2f}) as the "
                     f"camera moves — keep stamps 15-70 % from the top for their whole life")
    for i, lb in enumerate(s.get("labels") or []):
        if str(lb.get("reveal")) == "rise" and _num(lb.get("elev"), 0) > 30:
            v.append(f"label_edge: labels:{i} rises in high in the sky — use reveal type or fade for high stamps")
    # night readability: an extreme wide at night needs a readable silhouette on the horizon
    if str((s.get("look") or {}).get("time")) == "night" and scale_of(s) == "extreme_wide":
        frac = met.get("hero_frac")
        if frac is None or frac < 0.2:
            v.append("night_void: an extreme wide at night reads as a tiny ship in a blue void — make it wide, or a low "
                     "camera with the lit hero >= 20 % of the frame width on the horizon line")
    # wrong stand-ins: a second Titanic model, or the Titanic model named as another ship, up close
    liners = [o for o in s.get("objects") or [] if str(o.get("kind")) == "ship.liner_1912"]
    own = lambda o: any(k in o or k in (o.get("params") or {}) for k in ("funnels", "length", "livery"))
    cam0 = None
    ks0 = _keys_sorted(s.get("camera") or {}, _num(s.get("dur"), 4.0)) if (s.get("camera") or {}).get("move") == "keys" else []
    if ks0:
        cam0 = _key_cam(ks0[0][1], s, s.get("camera") or {}, ks0[0][0])[0]
    near = lambda o: cam0 is None or math.hypot(cam0[0] - _xz(o.get("at") or [0, 0])[0],
                                                cam0[2] - _xz(o.get("at") or [0, 0])[1]) < 4000
    others = liners[1:] if len(liners) > 1 else (liners if OTHER_SHIPS.search(str(s.get("beat") or "")) else [])
    for o in others:
        if not own(o) and near(o):
            v.append("wrong_standin: the four-funnel Titanic model stands in for another ship — give it its own "
                     "funnels/length/livery (COOKBOOK) or keep it a line of lights > 4 km away")
            break
    return met, v


def power_backed(s: dict, pw: str, nxt: dict = None) -> str:
    """"" when the declared superpower is really in the spec, else why not"""
    clock = s.get("clock") or {}
    rates = [_num(k.get("rate"), 1) for k in clock.get("keys") or [] if isinstance(k, dict)]
    if pw == "bullet_time":
        if clock.get("freeze_at") is not None or _num(clock.get("rate"), 1) <= 0.05 or any(r <= 0.05 for r in rates):
            return ""
        return "needs a frozen world: clock freeze_at, or rate 0, or keys easing to 0"
    if pw == "time_compression":
        if _num(clock.get("rate"), 1) >= 4 or any(r >= 4 for r in rates):
            return ""
        return "needs the world to race: clock rate >= 4 (10–60 for hours in seconds)"
    if pw == "globe_dive":
        return "" if any(str(o.get("kind")) == "space.earth" for o in s.get("objects") or []) else \
            "needs the Earth in the shot (space.earth) and a whiteout into the next"
    if pw == "then_now":
        tr = s.get("transition") or {}
        return "" if "dissolve" in (tr.get("in"), tr.get("out")) or nxt is not None else \
            "needs its partner shot (the same camera, another time) right after it"
    if pw == "scale":
        big = any(_num(g.get("count"), 0) >= 150 for g in s.get("groups") or [])
        many = max([sum(1 for o in s.get("objects") or [] if o.get("kind") == k)
                    for k in {o.get("kind") for o in s.get("objects") or []}] or [0]) >= 8
        return "" if big or many else "needs the data made physical: a crowd of >= 150 or >= 8 of one object"
    return ""                                                   # impossible_pov, cutaway, underwater, wreck: as declared


TIME_CUE = re.compile(r"\b(dawn|sunrise|sun|morning|daybreak|daylight|first light|sunset|dusk|evening|noon|"
                      r"afternoon|next day|days? (earlier|later))\b", re.I)
DAYISH = ("dawn", "dusk", "golden", "morning", "noon", "afternoon", "overcast")
INSERT_MAX_M = 1.4        # an insert frames the prop's readable face from macro distance
INSERT_TO_M = 0.8
HERO_FRAC_NAMED = 0.12    # a name label needs its person >= ~12 % of the frame height


def _shot_words(m: dict, t0: float, t1: float) -> str:
    return " ".join(str(w[0]) for w in m.get("words") or [] if t0 - 0.05 <= float(w[1]) < t1 - 0.05)


def _frames_person(s: dict, cid: str) -> bool:
    """the shot has the person and its camera is on them (target) or, for keys, holds them >= ~12 % of the frame"""
    if cid not in [str(c.get("ref")) for c in s.get("cast") or []]:
        return False
    cam = s.get("camera") or {}
    if str(cam.get("target")) != f"ref:{cid}":
        return False
    if cam.get("move") != "keys":
        return True                                             # a template move frames its target
    met = camera_metrics(s)
    if met.get("hero_frac") is not None and met["hero_frac"] < HERO_FRAC_NAMED:
        return False
    # keys look where they say: the person must project inside the frame at a key (not behind the lens, not off it)
    ks = _keys_sorted(cam, _num(s.get("dur"), 3.0))
    for t, k in ks:
        pos, look, fov = _key_cam(k, s, cam, t)
        tp = target_of(s, f"ref:{cid}", t)
        sp = _project(pos, look, fov, (tp[0], tp[1], tp[2])) if tp else None
        if sp and abs(sp[0]) < 0.9 and abs(sp[1]) < 0.9:
            return True
    return False


def autofix(board: dict, catalog: dict, warn: list) -> list:
    """the mechanical fixes made before any review round (they must not cost a round): the time of day follows the
    story clock, a name label goes to a shot that frames its person (or goes), an insert camera comes in to macro
    distance. -> the notes of what was changed (also appended to warn)"""
    notes = []
    castdefs = {str(c.get("id")): c for c in board.get("cast") or [] if isinstance(c, dict) and c.get("id")}
    kinds = _kinds(catalog or {})
    prev_clock = None
    for m in board.get("moments") or []:
        sc = m.get("scenes") or []
        # 1. time of day: the moment's clock = the majority of its exterior shots; a shot off the clock with no word
        #    naming a change of light is put back on it; a twilight/day moment right after night, with no such word,
        #    stays night
        ext = [s for s in sc if not _interior(s)]
        times = [str((s.get("look") or {}).get("time") or "") for s in ext if (s.get("look") or {}).get("time")]
        if times:
            clock = max(set(times), key=times.count)
            words = " ".join(str(w[0]) for w in m.get("words") or []) or str(m.get("text") or "")
            if clock in DAYISH and prev_clock == "night" and not TIME_CUE.search(words):
                clock = "night"
            t = _num(m.get("t0"), 0)
            for s in sc:
                look = s.setdefault("look", {})
                cur = str(look.get("time") or "")
                sw = _shot_words(m, t, t + _num(s.get("dur"), 0))
                if cur and cur != clock and not _interior(s) and not TIME_CUE.search(sw):
                    look["time"] = clock
                    if clock == "night" and look.get("sky") not in (None, "clear"):
                        look["sky"] = "clear"
                    notes.append(f"{s['id']}: time_jump fixed — {cur} -> {clock} (the story clock of moment {m['id']})")
                t += _num(s.get("dur"), 0)
            prev_clock = clock
        # 2. a name label needs its person framed: move it to the moment's shot that frames them, else drop it
        for s in sc:
            keep = []
            for lb in s.get("labels") or []:
                on = str(lb.get("on") or "")
                cid = on[4:] if on.startswith("ref:") else None
                if not cid:
                    txt = f"{lb.get('text', '')} {lb.get('sub', '')}".lower()
                    for i, c in castdefs.items():
                        last = str(c.get("name") or "").split()[-1:] or [""]
                        if last[0] and last[0].lower() in txt:
                            cid = i
                            break
                if not cid or _frames_person(s, cid):
                    keep.append(lb)
                    continue
                home = next((x for x in sc if x is not s and _frames_person(x, cid)), None)
                if home is not None and not home.get("labels"):
                    ln = max(1.2, _num(lb.get("t_out"), 2.0) - _num(lb.get("t_in"), 0.3))
                    lb["t_in"] = 0.3
                    lb["t_out"] = round(min(_num(home.get("dur"), 2.0) - 0.2, 0.3 + ln), 2)
                    home["labels"] = [lb]
                    notes.append(f"{s['id']}: label_no_person fixed — '{lb.get('text')}' moved to {home['id']}, which "
                                 f"frames {cid}")
                else:
                    notes.append(f"{s['id']}: label_no_person — '{lb.get('text')}' dropped: no shot frames {cid} "
                                 f"(put a close shot on him first)")
            s["labels"] = keep
        # 3. inserts: the camera comes in to macro distance on the prop's readable face
        for s in sc:
            cam = s.get("camera") or {}
            tg = str(cam.get("target") or "")
            mo = re.match(r"objects:(\d+)$", tg)
            obj = (s.get("objects") or [None] * 99)[int(mo.group(1))] if mo and int(mo.group(1)) < len(s.get("objects") or []) else None
            is_detail = bool(obj) and str(obj.get("kind", "")).startswith("detail.")
            if cam.get("move") != "keys" or not (scale_of(s) == "insert" or is_detail):
                continue
            moved = False
            for k in cam.get("keys") or []:
                if not isinstance(k, dict) or not isinstance(k.get("at"), (list, tuple)):
                    continue
                if isinstance(k.get("look_at"), (list, tuple)):
                    lx, lz = _xz(k["look_at"])
                    ly = _num(k.get("look_h"), 1.0)
                elif obj is not None:
                    lx, lz = _xz(obj.get("at") or [0, 0])
                    ly = _num(k.get("look_h"), 0.5)
                else:
                    continue
                cx, cz = _xz(k["at"])
                cy = _num(k.get("alt"), 1.0)
                d = math.sqrt((cx - lx) ** 2 + (cy - ly) ** 2 + (cz - lz) ** 2)
                if d > INSERT_MAX_M:
                    f = INSERT_TO_M / d
                    k["at"] = [round(lx + (cx - lx) * f, 3), round(lz + (cz - lz) * f, 3)]
                    k["alt"] = round(max(0.2, ly + (cy - ly) * f), 3)
                    moved = True
            if moved:
                notes.append(f"{s['id']}: insert camera brought in to ~{INSERT_TO_M} m of the prop's face")
    warn.extend(notes)
    return notes


def _interior(s: dict) -> bool:
    return any(str(it.get("kind", "")).startswith("interior.") for it in s.get("structures") or [])


def board_checks(board: dict, moments_meta: list = None, catalog: dict = None) -> dict:
    """the whole storyboard against the v2 grammar -> {"scenes": {id: [violations]}, "moments": {id: [...]},
    "board": [...], "metrics": {id: {...}}, "stats": {...}}"""
    res = {"scenes": {}, "moments": {}, "board": [], "metrics": {}, "stats": {}}
    seq = []
    for m in board.get("moments") or []:
        length = _num(m.get("t1"), 0) - _num(m.get("t0"), 0)
        sc = m.get("scenes") or []
        mv = []
        if length > 0 and len(sc) < shots_needed(length):
            mv.append(f"too_few_shots: {len(sc)} shot(s) for {length:.1f} s — needs >= {shots_needed(length)} "
                      f"(restructure the moment: return it under \"moments\")")
        t = _num(m.get("t0"), 0)
        feats = engine_features(catalog)
        money = {str(x.get("scene")) for x in board.get("money_shots") or [] if isinstance(x, dict)}
        for s in sc:
            met, v = scene_checks(s, feats, money)
            met["t0"] = round(t, 2)
            res["metrics"][s["id"]] = met
            res["scenes"][s["id"]] = v
            seq.append((m, s, t))
            t += _num(s.get("dur"), 0)
        if mv:
            res["moments"][m["id"]] = mv
    # neighbours: the same move / kind of keys motion / scale twice in a row (inside a moment, and across moments that
    # touch)
    for (ma, a, ta), (mb, b, tb) in zip(seq, seq[1:]):
        if abs(tb - (ta + _num(a.get("dur"), 0))) > 0.5:
            continue
        ka, kb = res["metrics"][a["id"]].get("kind"), res["metrics"][b["id"]].get("kind")
        if ka and ka == kb:
            res["scenes"][b["id"]].append(f"repeat_move: the same move as the shot before ({kb}) — change it")
        sa, sb = scale_of(a), scale_of(b)
        if sa and sa == sb:
            res["scenes"][b["id"]].append(f"repeat_scale: {sb} after {sa} — climb or descend the scale ladder")
    # the cold open: the first 3D moment of the video
    if seq and _num(seq[0][2], 99) < 1.0:
        first = seq[0][1]
        if _num(first.get("dur"), 0) > FIRST_MAX + 0.05:
            res["scenes"][first["id"]].append(f"first_shot_long: the first shot of the video is {first['dur']:.1f} s "
                                              f"(<= {FIRST_MAX:.0f} s, the hero big within 1 s)")
        t_open = seq[0][2]
        n_open = sum(1 for _, s, t in seq if t < t_open + COLD_OPEN_S - 0.05)
        if n_open < COLD_OPEN_MIN:
            res["board"].append(f"cold_open_slow: {n_open} shot(s) start in the first {COLD_OPEN_S:.0f} s (>= "
                                f"{COLD_OPEN_MIN})")
    # the ending is the payoff: bright, readable, composed
    if seq:
        last = seq[-1][1]
        lk = last.get("look") or {}
        if str(lk.get("time")) in ("night", "dusk") and not _interior(last):
            res["scenes"][last["id"]].append("ending_dark: the final image is the payoff — bright, readable, composed "
                                             "(e.g. a lifeboat silhouetted against the dawn glow, the rescue ship "
                                             "arriving); not a dark frame")
        elif str(lk.get("time")) in ("dawn", "golden") and _num(lk.get("exposure"), 1.0) < 1.1:
            res["scenes"][last["id"]].append("ending_dark: a dawn ending needs exposure >= 1.1 and the glow in frame (the "
                                             "camera facing the sunrise, the boats silhouetted against it)")
    # Robin: drone shots and FPV. The cold open's first or second shot is an FPV move on the hero; every ~10 s of
    # exterior shots has a drone move
    if seq and _num(seq[0][2], 99) < 1.0:
        firsts = [x[1] for x in seq[:2] if not _interior(x[1])]
        if firsts and not any((x.get("camera") or {}).get("move") in FPV for x in firsts):
            res["scenes"][firsts[0]["id"]].append("cold_open_no_fpv: the cold open's first or second shot must be an "
                                                  "FPV move on the hero (fpv_dive / fpv_flythrough / tracking_low)")
    run_s, run_ids = 0.0, []
    for _, s, _t in seq:
        if _interior(s):
            run_s, run_ids = 0.0, []
            continue
        if (s.get("camera") or {}).get("move") in DRONE:
            run_s, run_ids = 0.0, []
            continue
        run_s += _num(s.get("dur"), 0)
        run_ids.append(s["id"])
        if run_s > DRONE_EVERY_S + 0.05:
            res["scenes"][s["id"]].append(f"no_drone: {run_s:.0f} s of exterior shots ({', '.join(run_ids)}) without a "
                                          f"drone move — make one of them fpv_*/tracking_low/reveal_rise/orbit/crane_down")
            run_s, run_ids = 0.0, []
    # the story: a named object the kit can show gets its insert; a named person is on screen or seen through
    kinds = set(_kinds(catalog or {}))
    castdefs = [c for c in board.get("cast") or [] if isinstance(c, dict)]
    for m in board.get("moments") or []:
        sc = m.get("scenes") or []
        ws = m.get("words") or []
        text = " ".join(str(w[0]) for w in ws) if ws else str(m.get("text") or "")
        if not text or not sc:
            continue
        shown = {str(o.get("kind")) for s in sc for o in (s.get("objects") or []) + (s.get("structures") or [])}
        if any(k.startswith("detail.") for k in kinds):
            for pat, cands in DETAIL_WORDS:
                have = [k for k in cands if k in kinds]
                hit = re.search(pat, text, re.I)
                if not have or not hit:
                    continue
                if not (set(have) & shown):
                    res["moments"].setdefault(m["id"], []).append(
                        f"detail_missing: the words name \"{hit.group(0)}\" and no insert shows it — cut to a "
                        f"{have[0]} insert (1.5–2.5 s, macro, shallow focus) at that word")
                    break                                       # one insert asked per moment ("sometimes")
        # people named in the words: CastDef names, and First-Last capitalised pairs
        named = []
        for c in castdefs:
            last = str(c.get("name") or c.get("id") or "").split()[-1:] or [""]
            if last[0] and re.search(rf"\b{re.escape(last[0])}\b", text):
                named.append((last[0], c.get("id")))
        for a, b in re.findall(r"\b([A-Z][a-z]+) ([A-Z][a-z]+)\b", text):
            if a.lower() in NOT_PEOPLE or b.lower() in NOT_PEOPLE:
                continue
            if not any(b == n for n, _ in named):
                named.append((b, None))
        for last, cid in named:
            low = last.lower()
            seen = False
            for s in sc:
                refs = [str(x.get("ref")) for x in s.get("cast") or []]
                if cid and cid in refs:
                    seen = True
                if any(low in str(d.get("name", "")).lower() and str(d.get("id")) in refs for d in castdefs):
                    seen = True
                if low in str(s.get("pov") or "").lower() or (cid and str(s.get("pov")) == str(cid)):
                    seen = True
                if low in str(s.get("beat") or "").lower():
                    seen = True
            if not seen:
                res["moments"].setdefault(m["id"], []).append(
                    f"no_pov: the words name {last} and no shot shows him or his view — put him on screen (cast; on a "
                    f"ship at its deck point) or give a shot his \"pov\"")
    # 3D superpowers: one every ~15 s and one in the cold open, each backed by its syntax
    since, first_power = 0.0, None
    for i, (m, s, t) in enumerate(seq):
        pw = str(s.get("power") or "").split()[0].strip(",.;:").lower() if s.get("power") else ""
        if pw:
            why = power_backed(s, pw, seq[i + 1][1] if i + 1 < len(seq) else None)
            if why:
                res["scenes"][s["id"]].append(f"power_unbacked: \"{pw}\" {why}")
            else:
                since = 0.0
                if first_power is None:
                    first_power = t
                continue
        since += _num(s.get("dur"), 0)
        if since > POWER_EVERY_S + 0.05:
            res["scenes"][s["id"]].append(f"no_superpower: {since:.0f} s without a 3D superpower (bullet time, time "
                                          f"compression, scale, an impossible POV, a globe dive, then/now...)")
            since = 0.0
    if seq and _num(seq[0][2], 99) < 1.0 and (first_power is None or first_power > seq[0][2] + COLD_OPEN_S):
        res["board"].append("cold_open_no_power: the cold open has no 3D superpower in its first 10 s")
    # holds and labels per minute of 3D
    total = sum(_num(s.get("dur"), 0) for _, s, _ in seq)
    holds = [s for _, s, _ in seq if _num(s.get("dur"), 0) > HOLD_SHOT + 0.05]
    allowed = max(1, int(round(total / 60.0)))
    if len(holds) > allowed:
        res["board"].append(f"too_many_holds: {len(holds)} shots over {HOLD_SHOT:.0f} s "
                            f"({', '.join(s['id'] for s in holds)}) — {allowed} allowed for {total:.0f} s; cut them")
    n_labels = sum(len(s.get("labels") or []) for _, s, _ in seq)
    if n_labels > max(1, int(total / LABEL_EVERY_S) + 1):
        res["board"].append(f"too_much_text: {n_labels} labels in {total:.0f} s (<= one per ~{LABEL_EVERY_S:.0f} s)")
    ids = {s["id"] for _, s, _ in seq}
    ms = board.get("money_shots") or []
    if not ms:
        res["board"].append("no_money_shots: list the 3-6 images the audience expects and the scene of each")
    for x in ms:
        if isinstance(x, dict) and x.get("scene") and x["scene"] not in ids and "closest" not in str(x.get("kit", "")):
            res["board"].append(f"money_shot_missing: '{str(x.get('image', ''))[:60]}' names scene {x['scene']}, "
                                f"which does not exist")
    durs = [_num(s.get("dur"), 0) for _, s, _ in seq]
    kinds = {}
    for _, s, _ in seq:
        k = res["metrics"][s["id"]].get("kind", "?")
        kinds[k] = kinds.get(k, 0) + 1
    res["stats"] = {"shots": len(seq), "seconds": round(total, 2),
                    "avg": round(total / max(1, len(seq)), 2), "max": round(max(durs or [0]), 2),
                    "min": round(min(durs or [0]), 2), "moves": dict(sorted(kinds.items(), key=lambda x: -x[1])),
                    "violations": sum(len(v) for v in res["scenes"].values()) + sum(len(v) for v in res["moments"].values())
                    + len(res["board"])}
    return res


def checks_text(chk: dict, ids: list = None) -> str:
    """the violations as lines for a prompt (only the scenes/moments in `ids` when given)"""
    rows = list(chk.get("board") or [])
    for mid, v in (chk.get("moments") or {}).items():
        rows += [f"moment {mid}: {x}" for x in v]
    for sid, v in (chk.get("scenes") or {}).items():
        if ids is not None and sid not in ids:
            continue
        rows += [f"{sid}: {x}" for x in v]
    return "\n".join(rows)


def validate(board: dict, moments: list, catalog: dict) -> tuple:
    """fix what can be fixed, report what was changed; raises only when the board is unusable"""
    warn = []
    board["cast"] = clean_cast(board.get("cast"))
    kinds = _kinds(catalog)
    moves = moves_of(catalog)
    biomes = sorted({k.split(".", 1)[1] for k in kinds if k.startswith("biome.")}) or ["plains"]
    cast_ids = {c.get("id") for c in board.get("cast", []) or [] if isinstance(c, dict) and c.get("id")}
    cast_ids.add("witness")
    by_id = {str(m["id"]): m for m in moments}
    out_moments, seen = [], set()
    for bm in board.get("moments", []) or []:
        if not isinstance(bm, dict) or str(bm.get("id")) not in by_id:
            continue
        m = by_id[str(bm["id"])]
        length = m["t1"] - m["t0"]
        scenes = [s for s in bm.get("scenes", []) or [] if isinstance(s, dict)]
        if not scenes:
            continue
        for i, s in enumerate(scenes):
            sid = re.sub(r"[^A-Za-z0-9_]", "_", str(s.get("id") or f"m{m['id']}s{i}"))[:40]
            if sid in seen:
                sid = f"{sid}_{m['id']}_{i}"
            seen.add(sid)
            s["id"] = sid
            s["_designed_dur"] = _num(s.get("dur"), length / len(scenes))
            s["dur"] = max(engine_min_shot(), min(24.0, s["_designed_dur"]))
            clean_scene(s, kinds, cast_ids, biomes, warn, moves, catalog)
        scenes = fit_durations(scenes, length, warn, m["id"])
        for x in scenes:
            x.pop("_designed_dur", None)
        pair_dissolves(scenes, warn, m["id"])
        out_moments.append({"id": m["id"], "t0": m["t0"], "t1": m["t1"], "scenes": scenes,
                            **({"words": m["words"]} if m.get("words") else {})})
    if not out_moments:
        raise ValueError("the storyboard has no usable moment")
    missing = [m["id"] for m in moments if str(m["id"]) not in {str(x["id"]) for x in out_moments}]
    if missing: warn.append(f"moments without scenes: {missing}")
    ms = [x for x in board.get("money_shots") or [] if isinstance(x, dict) and x.get("image")]
    motifs = [x for x in board.get("motifs") or [] if isinstance(x, dict)]
    out = {"throughline": board.get("throughline", ""), "money_shots": ms, "motifs": motifs,
           "cast": board.get("cast", []) or [], "moments": out_moments}
    autofix(out, catalog, warn)
    return out, warn


def pair_dissolves(scenes: list, warn: list, mid) -> None:
    """a dissolve joins two shots of one moment: `out` of the first and `in` of the next both say so; a dissolve at a
    moment's edge (another clip, footage or a map on the other side) becomes a cut"""
    for i, s in enumerate(scenes):
        tr = s.setdefault("transition", {})
        nxt = scenes[i + 1] if i + 1 < len(scenes) else None
        if tr.get("out") == "dissolve" or (nxt and (nxt.get("transition") or {}).get("in") == "dissolve"):
            if nxt:
                tr["out"] = "dissolve"
                nxt.setdefault("transition", {})["in"] = "dissolve"
            else:
                tr["out"] = "cut"
                warn.append(f"moment {mid}: a dissolve out of its last shot {s['id']} -> cut (dissolves join two shots "
                            f"of one moment)")
    if scenes and (scenes[0].get("transition") or {}).get("in") == "dissolve":
        scenes[0]["transition"]["in"] = "cut"
        warn.append(f"moment {mid}: a dissolve into its first shot {scenes[0]['id']} -> cut")


def retime_scene(s: dict, k: float) -> None:
    """a shot whose length changed by the factor k: every time track of the SCENE clock scales with it (camera keys,
    lens, focus pulls, shakes, dolly zoom, clock keys / freeze_at / sync, labels, cast and group action times), so the
    camera still moves to the end and the text still lands inside the shot (world-time params — a sink's t0, an FX —
    are left: they belong to the world clock)"""
    if abs(k - 1.0) < 0.01:
        return
    sc = lambda v: round(float(v) * k, 3) if isinstance(v, (int, float)) else v
    cam = s.get("camera") or {}
    for key in ("keys", "lens", "focus", "shake"):
        for x in cam.get(key) or []:
            if isinstance(x, dict) and "t" in x:
                x["t"] = sc(x["t"])
    dz = cam.get("dolly_zoom")
    if isinstance(dz, dict) and isinstance(dz.get("t"), list):
        dz["t"] = [sc(v) for v in dz["t"]]
    for key in ("glances", "stumbles"):
        if isinstance(cam.get(key), list):
            cam[key] = [sc(v) for v in cam[key]]
    clock = s.get("clock")
    if isinstance(clock, dict):
        for x in clock.get("keys") or []:
            if isinstance(x, dict):
                x["t"] = sc(x.get("t"))
        if "freeze_at" in clock:
            clock["freeze_at"] = sc(clock["freeze_at"])
        if isinstance(clock.get("sync"), dict):
            clock["sync"]["t"] = sc(clock["sync"].get("t"))
    for lb in s.get("labels") or []:
        for key in ("t_in", "t_out"):
            if key in lb:
                lb[key] = sc(lb[key])
        if isinstance(lb.get("t"), list):
            lb["t"] = [sc(v) for v in lb["t"]]
    for it in (s.get("cast") or []) + (s.get("groups") or []):
        if isinstance(it, dict):
            if "start" in it:
                it["start"] = sc(it["start"])
            for a in it.get("actions") or []:
                if isinstance(a, dict) and "t" in a:
                    a["t"] = sc(a["t"])


def fit_durations(scenes: list, length: float, warn: list, mid) -> list:
    """the scene durations of a moment must fill it exactly, every shot >= the engine's shortest: drop shots that
    cannot fit, scale, lift short shots to the minimum from the longer ones, then fix the rounding on the last scene"""
    MIN_SHOT = engine_min_shot()
    designed = {id(x): _num(x.get("_designed_dur"), 0) or x["dur"] for x in scenes}
    while len(scenes) > 1 and len(scenes) * MIN_SHOT > length + 1e-6:
        warn.append(f"moment {mid}: {len(scenes)} shots cannot fit {length:.1f} s at >= {MIN_SHOT:.0f} s — dropped "
                    f"{scenes[-1]['id']}")
        scenes = scenes[:-1]
    tot = sum(s["dur"] for s in scenes) or 1.0
    k = length / tot
    if abs(tot - length) > 0.02:
        for s in scenes:
            s["dur"] = s["dur"] * k
        if abs(k - 1) > 0.1: warn.append(f"moment {mid} durations scaled x{k:.2f}")
    for _ in range(4):
        short = [s for s in scenes if s["dur"] < MIN_SHOT - 1e-6]
        if not short:
            break
        need = sum(MIN_SHOT - s["dur"] for s in short)
        for s in short:
            s["dur"] = MIN_SHOT
        donors = [s for s in scenes if s["dur"] > MIN_SHOT + 1e-6]
        room = sum(s["dur"] - MIN_SHOT for s in donors) or 1.0
        for s in donors:
            s["dur"] -= need * (s["dur"] - MIN_SHOT) / room
    for s in scenes:
        s["dur"] = round(s["dur"], 3)
    if len(scenes) == 1:
        scenes[0]["dur"] = round(length, 3)
    else:
        scenes[-1]["dur"] = round(length - sum(s["dur"] for s in scenes[:-1]), 3)
    for x in scenes:                              # the camera, text and actions keep pace with the new length
        d0 = designed.get(id(x)) or x["dur"]
        if d0 > 0:
            retime_scene(x, x["dur"] / d0)
    return scenes


def storyboard(ask, title: str, lines: list, moments: list, catalog: dict, language_line: str = "Write in English.",
               log=print, context: str = "", section: str = "") -> dict:
    """one director call (+ one repair call if the JSON does not parse); returns the validated board. Its grammar
    violations are measured here and handed to the review (the next call) — never an extra director call."""
    prompt = build_prompt(title, lines, moments, catalog, language_line, context, section)
    raw = ask(prompt, DIRECTOR_TOKENS)
    try:
        board = _json_object(raw)
    except (ValueError, json.JSONDecodeError) as e:
        # a syntax slip in a long answer: the cheap repair call first (the same JSON, fixed), then the full question
        log(f"  3D director: the storyboard did not parse ({str(e)[:80]}) — asking for the same JSON, fixed")
        try:
            board = _json_object(ask("The JSON object below does not parse (" + str(e)[:120] + "). Return the SAME object "
                                     "with only its syntax fixed — valid JSON, nothing else, no prose, no fences.\n\n"
                                     + (raw or "")[-120000:], DIRECTOR_TOKENS))
        except (ValueError, json.JSONDecodeError) as e2:
            log(f"  3D director: still no valid JSON ({str(e2)[:80]}) — asking once more from the start")
            raw = ask(prompt + "\n\nYour previous reply was not valid JSON. Output ONLY the JSON object.", DIRECTOR_TOKENS)
            board = _json_object(raw)
    board, warn = validate(board, moments, catalog)
    for w in warn[:30]:
        log(f"  3D director: {w}")
    return board


# ── review and fix ─────────────────────────────────────────────────────────────────────────────────────────────────
def _quality() -> str:
    try:
        return (HERE.parent / "QUALITY.md").read_text(encoding="utf-8")
    except OSError:
        return "(QUALITY.md missing: score story, subject, motion, craft, life 0-2 each)"


def sequence_text(board: dict, chk: dict) -> str:
    """the whole film's shot list, one line per shot (repetition and rhythm are judged over the whole film)"""
    rows = []
    for m in board.get("moments") or []:
        t = _num(m.get("t0"), 0)
        for s in m.get("scenes") or []:
            met = (chk.get("metrics") or {}).get(s["id"], {})
            extra = "".join(f" [{k} {s[k]}]" for k in ("pov", "power") if s.get(k))
            rows.append(f"{t:6.1f} {s['id']:<22} {_num(s.get('dur'), 0):4.1f}s {met.get('kind', '?'):<16} "
                        f"{scale_of(s) or '?':<12} {str(s.get('beat', ''))[:90]}{extra}")
            t += _num(s.get("dur"), 0)
    return "\n".join(rows)


def metrics_line(met: dict) -> str:
    bits = [f"{met.get('dur', 0):.1f} s", str(met.get("kind", "?")), f"scale {met.get('scale', '?')}"]
    if "zoom" in met:
        bits.append(f"size x{met['zoom']:.2f}, arc {met['arc']:.0f}°, view {met['pan']:.0f}°, travel {met['travel']:.0f} m")
    if met.get("hero_frac") is not None:
        bits.append(("person" if met.get("hero") == "person_h" else "ship") + f" {100 * met['hero_frac']:.0f} % of the frame")
    return ", ".join(bits)


def review_prompt(title: str, board: dict, sheet_rows: list, words: dict, issues: dict, round_no: int, rounds: int,
                  language_line: str = "Write in English.", context: str = "", checks: dict = None,
                  full_board: dict = None, catalog: dict = None) -> str:
    tpl = filter_needs(_read("review.md"), catalog or {})
    checks = checks or {"scenes": {}, "moments": {}, "board": [], "metrics": {}}
    scenes = [s for m in board["moments"] for s in m["scenes"]]
    ids = {s["id"] for s in scenes}
    narr = "\n".join(f"{s['id']} ({s['dur']:.1f} s): {words.get(s['id'], '')}" for s in scenes)
    iss = "\n".join(f"{sid}: {'; '.join(v)}" for sid, v in issues.items() if v) or "(none)"
    met = "\n".join(f"{s['id']}: {metrics_line(checks['metrics'].get(s['id'], {}))}" for s in scenes)
    mids = {m["id"] for m in board["moments"]}
    vio = [x for x in checks.get("board") or []]
    vio += [f"moment {mid}: {x}" for mid, v in (checks.get("moments") or {}).items() if mid in mids for x in v]
    vio += [f"{sid}: {x}" for sid, v in (checks.get("scenes") or {}).items() if sid in ids for x in v]
    moms = "\n".join(f"moment {m['id']}: {m['t0']:.1f}-{m['t1']:.1f} s ({m['t1'] - m['t0']:.1f} s, >= "
                     f"{shots_needed(m['t1'] - m['t0'])} shots): " + ", ".join(s["id"] for s in m["scenes"])
                     for m in board["moments"])
    money = [x for x in (full_board or board).get("money_shots") or [] if isinstance(x, dict)]
    moms = ("money shots: " + ("; ".join(f"'{x.get('image', '')}' -> {x.get('scene') or '(none)'}"
                                         + (f" [{x.get('kit')}]" if x.get("kit") else "") for x in money)
                               if money else "(none listed — name them and give each a hero shot)") + "\n" + moms)
    spec = json.dumps({"throughline": board.get("throughline", ""), "money_shots": board.get("money_shots", []),
                       "cast": board.get("cast", []), "scenes": scenes}, ensure_ascii=False)
    moves = moves_of(catalog or {})
    tpl = tpl.replace("[DRONE MOVES]", ", ".join(m for m in DRONE if m in moves))
    return (tpl.replace("[LANGUAGE LINE]", language_line).replace("[TITLE]", title)
            .replace("[ROUND]", f"{round_no}/{rounds}").replace("[SHEET]", "\n".join(sheet_rows))
            .replace("[LAST ROUND]", LAST_ROUND if round_no >= rounds else "")
            .replace("[NARRATION]", narr).replace("[ISSUES]", iss).replace("[METRICS]", met)
            .replace("[VIOLATIONS]", "\n".join(vio) or "(none)").replace("[MOMENTS]", moms)
            .replace("[SEQUENCE]", sequence_text(full_board or board, checks))
            .replace("[CONTEXT]", context or "(none)").replace("[RUBRIC]", _quality())
            .replace("[COOKBOOK]", cookbook(catalog or {})).replace("[SPECS]", spec))


LAST_ROUND = ("- THIS IS THE LAST ROUND — A HARD-FAIL REPAIR ROUND: nothing you change now is previewed again before the "
              "final render. Return ONLY shots that have a hard fail, each with the smallest safe fix (camera "
              "distance, altitude, lens, target, exposure, timing); no restructured moments, no new moves, no new "
              "kinds. Everything else stays as it is (changes to other shots are ignored).")


def _scores(reply: dict) -> dict:
    """{scene id: {"total": 0-10, "hard": [...], ...}} — the total is recomputed from the five criteria and capped at 4
    by a hard fail (QUALITY.md)"""
    out = {}
    for x in reply.get("scores") or []:
        if not isinstance(x, dict) or not x.get("id"):
            continue
        parts = [max(0.0, min(2.0, _num(x.get(k), 1.0))) for k in ("story", "subject", "motion", "craft", "life")]
        hard = [str(h) for h in (x.get("hard") or []) if str(h).strip()]
        total = sum(parts) if any(k in x for k in ("story", "subject", "motion", "craft", "life")) else _num(x.get("total"), 0)
        if hard:
            total = min(total, 4.0)
        out[str(x["id"])] = {"total": round(total, 1), "hard": hard, "see": str(x.get("see") or x.get("fix") or "")[:200],
                             "parts": parts}
    return out


def _keep_drone(old: dict, new: dict, flagged, warn: list) -> None:
    """Robin asked for drone shots: a drone move the engine did not flag stays a drone move (its camera block comes
    back; every other fix of the reviewer is kept)"""
    if flagged is None or not old or not new:
        return
    om, nm = (old.get("camera") or {}).get("move"), (new.get("camera") or {}).get("move")
    if om in DRONE and nm == "keys" and old.get("id") not in flagged:
        new["camera"] = copy.deepcopy(old["camera"])
        warn.append(f"{new.get('id')}: kept the drone move {om} (the engine did not flag it; fix its numbers instead)")


def apply_review(board: dict, reply: dict, catalog: dict, log=print, flagged: set = None, last_round: bool = False) -> tuple:
    """merge the reviewer's work into the board: `moments` replaces a moment's whole shot list (split, merge,
    re-time: the durations are fitted to the moment), `scenes` replaces single scenes by id (their dur stays).
    Returns (new board, number of scenes changed, verdict, scores, ids of changed moments)."""
    new = copy.deepcopy(board)
    kinds = _kinds(catalog)
    moves = moves_of(catalog)
    biomes = sorted({k.split(".", 1)[1] for k in kinds if k.startswith("biome.")}) or ["plains"]
    if isinstance(reply.get("cast"), list) and reply["cast"]:
        ids = {c.get("id") for c in new.get("cast", []) if isinstance(c, dict)}
        for c in reply["cast"]:
            if isinstance(c, dict) and c.get("id"):
                if c["id"] in ids:
                    new["cast"] = [c if (isinstance(o, dict) and o.get("id") == c["id"]) else o for o in new["cast"]]
                else:
                    new["cast"].append(c)
    new["cast"] = clean_cast(new.get("cast"))
    if isinstance(reply.get("money_shots"), list) and reply["money_shots"]:
        new["money_shots"] = [x for x in reply["money_shots"] if isinstance(x, dict) and x.get("image")]
    cast_ids = {c.get("id") for c in new.get("cast", []) if isinstance(c, dict) and c.get("id")} | {"witness"}
    changed, warn, touched = 0, [], set()
    all_ids = {s["id"] for m in new["moments"] for s in m["scenes"]}
    scores_in = _scores(reply)
    if last_round:
        # the last round repairs hard fails only: no restructured moments, no change to a shot without a hard fail
        # (the reviewer's own or the engine's) — nothing it changes is seen again before the final render
        hard_ids = {k for k, v in scores_in.items() if v.get("hard")} | set(flagged or ())
        if reply.get("moments"):
            warn.append(f"last round: {len(reply['moments'])} restructured moment(s) ignored (hard-fail repairs only)")
        reply = dict(reply, moments=[], scenes=[x for x in reply.get("scenes") or []
                                                 if isinstance(x, dict) and str(x.get("id")) in hard_ids])
    # 1. restructured moments
    by_mid = {str(m["id"]): m for m in new["moments"]}
    for rm in reply.get("moments") or []:
        if not isinstance(rm, dict) or str(rm.get("id")) not in by_mid:
            continue
        m = by_mid[str(rm["id"])]
        scs = [copy.deepcopy(s) for s in rm.get("scenes") or [] if isinstance(s, dict)]
        if not scs:
            continue
        own = {s["id"] for s in m["scenes"]}
        prev = {s["id"]: s for s in m["scenes"]}
        for x in scs:
            _keep_drone(prev.get(str(x.get("id"))), x, flagged, warn)
        seen = set()
        for i, s in enumerate(scs):
            sid = re.sub(r"[^A-Za-z0-9_]", "_", str(s.get("id") or f"m{m['id']}r{i}"))[:40]
            if sid in seen or (sid in all_ids and sid not in own):
                sid = f"{sid}_r{i}"
            seen.add(sid)
            s["id"] = sid
            s["_designed_dur"] = _num(s.get("dur"), (m["t1"] - m["t0"]) / len(scs))
            s["dur"] = max(engine_min_shot(), min(24.0, s["_designed_dur"]))
            clean_scene(s, kinds, cast_ids, biomes, warn, moves, catalog)
        scs = fit_durations(scs, m["t1"] - m["t0"], warn, m["id"])
        for x in scs:
            x.pop("_designed_dur", None)
        pair_dissolves(scs, warn, m["id"])
        old = {s["id"]: s for s in m["scenes"]}
        n_changed = sum(1 for s in scs if json.dumps(s, sort_keys=True) != json.dumps(old.get(s["id"]), sort_keys=True))
        if n_changed or len(scs) != len(m["scenes"]):
            changed += max(n_changed, 1)
            m["scenes"] = scs
            touched.add(m["id"])
            all_ids = {s["id"] for mm in new["moments"] for s in mm["scenes"]}
    # 2. single scenes (not inside a moment restructured above)
    fixed = {str(s.get("id")): s for s in reply.get("scenes", []) or [] if isinstance(s, dict) and s.get("id")}
    for m in new["moments"]:
        if m["id"] in touched:
            continue
        for i, s in enumerate(m["scenes"]):
            f = fixed.get(s["id"])
            if not f:
                continue
            f = copy.deepcopy(f)
            f["id"], f["dur"] = s["id"], s["dur"]
            _keep_drone(s, f, flagged, warn)
            clean_scene(f, kinds, cast_ids, biomes, warn, moves, catalog)
            if json.dumps(f, sort_keys=True) != json.dumps(s, sort_keys=True):
                changed += 1
                m["scenes"][i] = f
                touched.add(m["id"])
    fixes = autofix(new, catalog, [])
    if fixes:
        warn.append(f"auto-fixed after the review: {len(fixes)} — " + " | ".join(f[:80] for f in fixes[:4]))
    for w in warn[:20]:
        log(f"  3D review: {w}")
    return new, changed, str(reply.get("verdict") or ("fixed" if changed else "ok")).lower(), scores_in, touched
