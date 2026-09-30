#!/usr/bin/env python3
"""kits.py — LOOK KITS: eight complete graphics languages, one per channel style.

A kit is a family of animated scenes that share one design system — its own fonts, palette, grounds,
layout and motion — so a channel built on it looks nothing like a channel built on another one:

    dossier     true crime / internet mysteries: a black table, typed alerts, red crosshairs, gold serif names
    kinetic     essays and business: the words are the picture — big single words, white pages, phone cards
    atlas       playful history: a thick-outline cartoon world, a time machine bar, a flipchart, paint wipes
    deep        military and tech mysteries: teal and orange, stencil datelines, sonar, cutaways, a map room
    deep2       DEEP-V2: the same scenes in amber — glowing gold type on black, lamp-lit consoles, a plotter's
                cross-section drawing, an amber radar screen
    frontline   NEWS — geopolitics: broadcast lower thirds, boxed labels, arrows over relief, a dated timeline, tickers
    legend      first-person sports and celebrity stories: numbered chapters, lower thirds, scorecards
    hustle      make-money and youth business: glossy black, glow, 3D icons, segmented bars, counters
    tape        creator-culture commentary: a dark studio, player windows, subscriber counters, posts, timelines
    almanac     history of people and things: collector's cards, name bars, a film strip, printing-press proofs
                (README-ALMANAC.md; almanac_prep.py prepares its real cut-outs and archive film)
    horizon     the data documentary: a country's line drawn by a following pen, population pyramids, generations,
                odometer figures, real documents and quotes (README-HORIZON.md; horizon.py fetches the numbers)

A style turns a kit on with `"look": {"graphics": "kit", "kit": "dossier"}`. The director (director.py)
then offers this kit's scene types instead of the documentary ones, and make_video routes the graphics
step here. Each scene is an HTML page rendered frame by frame in Chromium — the same contract as every
Frontier scene: everything on screen is computed from t alone (window.renderFrame(t)).

The scene JavaScript lives in assets/kits/<kit>.js: `build(S)` lays the scene out once, `frame(t)` moves it.
The fonts are bundled TTFs in assets/fonts/ (OFL / Apache), embedded into the page as base64 so the render
is identical on Windows, macOS and a rented Linux pod.

    python kits.py preview dossier            -> preview/kits/dossier_<type>.mp4 + .png for every scene type
    python kits.py preview all
    python kits.py check                      -> renders one frame of every type of every kit, reports JS errors
"""

import base64
import io as _io
import json
import math
import re
import shutil
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as _np
from PIL import Image as _Image

HERE = Path(__file__).resolve().parent
FONTS = HERE / "assets" / "fonts"
KIT_DIR = HERE / "assets" / "kits"
W, H, FPS = 1920, 1080, 30
SHUTTER = 3                 # sub-frames averaged per frame: motion blur on everything that moves (1 = off)

# ── the kits ─────────────────────────────────────────────────────────────────────
# fonts: (css family, file in assets/fonts, weight range, style) — embedded into the page
# types: scene type -> seconds
# prompt: what the designer / director may ask for, one JSON example per type (the fields the JS reads)
# sound: type -> [(second, sound, dB)] for sfx.py
KITS = {
    "dossier": {
        "label": "DOSSIER",
        "fonts": [("Kit Type", "SpecialElite.ttf", "400", "normal"), ("Kit Mono", "CourierPrime.ttf", "400", "normal"),
                  ("Kit Mono", "CourierPrime-Bold.ttf", "700", "normal"), ("Kit Serif", "Cinzel.ttf", "400 900", "normal"),
                  ("Kit Tele", "ShareTechMono.ttf", "400", "normal")],
        "palette": {"ink": "#EDE6D6", "red": "#E3231B", "marker": "#F5E14A", "gold": "#D9B25F", "paper": "#EDE6D6",
                    "blue": "#3B6FD9"},
        "types": {"alert": 6.5, "crosshair": 5.0, "disclaimer": 5.5, "title_gold": 5.0, "tracker": 5.5,
                  "dialogue": 6.5, "stack": 6.5, "stamp": 4.0},
        "prompt": """- graphic — a DOSSIER graphic (4-7 s), one of:
  {"tool": "graphic", "cue": 4, "words": "...", "type": "alert", "head": "CODE RED", "sub": "U.S. EMBASSY", "lines": ["URGENT ALERT", "ALL CITIZENS IN AFGHANISTAN"], "stamp": "EVACUATE NOW", "body": "one or two sentences of the real notice, warning or message, typed out"}
  {"tool": "graphic", "cue": 8, "words": "...", "type": "crosshair", "label": "PROOF", "icon": "folder", "sub": "13 Aug 2021"}
  {"tool": "graphic", "cue": 1, "words": "...", "type": "disclaimer", "title": "DISCLAIMER", "body": "two short sentences: what this video documents and that it endorses nothing", "foot": "VIEWER DISCRETION IS ADVISED"}
  {"tool": "graphic", "cue": 6, "words": "...", "type": "title_gold", "name": "MILES", "sub": "a 4chan user from Birmingham"}
  {"tool": "graphic", "cue": 11, "words": "...", "type": "tracker", "name": "Mary Jo Bailey", "tag": "SUSPECT", "year": "2022", "subject": "Mary Jo Bailey", "query": "Mary Jo Bailey arrest bodycam"}
  {"tool": "graphic", "cue": 15, "words": "...", "type": "dialogue", "a": "OFFICER", "b": "SUSPECT", "lines": [{"who": "a", "text": "we have a warrant for your arrest"}, {"who": "b", "text": "I got some appointments I'm supposed to be at"}]}
  {"tool": "graphic", "cue": 19, "words": "...", "type": "stack", "docs": [{"title": "4chan /pol/ — 13 Aug 2021", "lines": ["Decided to pop down to Afghanistan for a few days", "never been before. Just goofing off"], "mark": 0}, {"title": "Passport scan", "lines": ["ROUTLEDGE, MILES", "British citizen"], "mark": -1}]}
  {"tool": "graphic", "cue": 2, "words": "...", "type": "stamp", "text": "2021", "sub": "Kabul, Afghanistan"}
  alert = a real notice, warning, court order, message or post typed out like a teletype (only real text or a faithful
  summary marked as such); crosshair = a thing found or targeted (icon folder | photo | pin | phone); disclaimer = only at
  the very start of a story with violence or crime; title_gold = the main person's name the first time it matters;
  tracker = a real photo of a public person with a red tracking box, their name and a tag (SUSPECT, WITNESS, VICTIM only
  for public figures; private people get no photo); dialogue = 2-4 real exchanged lines between two people (police and
  suspect, two users, a call) typed in two colours; stack = 2-3 real documents, posts or messages as cards on the table,
  the key line marked yellow (mark = index of the line, -1 none); stamp = a year or a place typed big over the footage.""",
    },
    "kinetic": {
        "label": "KINETIC",
        "fonts": [("Kit Mono", "KodeMono.ttf", "400 700", "normal"), ("Kit Display", "InterDisplay-Black.ttf", "900", "normal"),
                  ("Kit Serif", "PlayfairDisplay.ttf", "400 900", "normal"), ("Kit Body", "Inter-Bold.ttf", "700", "normal"),
                  ("Kit Body", "Inter-SemiBold.ttf", "600", "normal")],
        "palette": {"ink": "#FFFFFF", "yellow": "#F2C230", "red": "#E5322D", "page": "#FAFAF8"},
        "types": {"bigword": 3.6, "board": 6.5, "doodle": 4.5, "phones": 7.5, "comment": 6.0, "scroll": 5.5, "mosaic": 4.0, "sources": 5.5},
        "prompt": """- graphic — a KINETIC graphic (3-7 s), one of:
  {"tool": "graphic", "cue": 1, "words": "where are they at", "type": "bigword", "words_big": ["where", "at?"]}
  {"tool": "graphic", "cue": 3, "words": "a good idea", "type": "doodle", "icon": "lightbulb", "text": "a good idea"}
  {"tool": "graphic", "cue": 5, "words": "...", "type": "board", "line": "are we in the middle of a good man shortage?", "inner": "ARE WE IN A 'GOOD MAN' SHORTAGE", "source": "The Social, CTV"}
  {"tool": "graphic", "cue": 9, "words": "...", "type": "phones", "cards": ["WHERE ARE ALL THE GOOD MEN", "CHILLING OR WAITING", "SO WHERE ARE THE SINGLE 30+ MEN"], "title": "Where Are All The Good Men?", "sub": "a Modern Wisdom production", "mark": "Good Men?"}
  {"tool": "graphic", "cue": 14, "words": "...", "type": "comment", "handle": "@user", "text": "I'm trapped in a generation where I don't know whether to buy her flowers, or ignore her, to get her to like me", "marks": ["buy her flowers", "ignore her"]}
  {"tool": "graphic", "cue": 18, "words": "...", "type": "scroll", "items": [{"headline": "Where Have All the Good Men Gone?", "outlet": "The Atlantic"}, {"headline": "The Good Men are still here, they're just tired", "outlet": "Vox"}], "bold": ["Good Men"]}
  {"tool": "graphic", "cue": 22, "words": "...", "type": "mosaic", "caption": "what they actually post", "labels": ["exhibit A", "exhibit B"]}
  {"tool": "graphic", "cue": 26, "words": "...", "type": "sources", "title": "the studies", "items": [{"text": "Pew Research, 2023 — 63% of men under 30 are single", "who": "Pew"}, {"text": "...", "who": "..."}]}
  bigword = one or two words of the sentence, huge and centred, one after another (a question, a turn); doodle = a chalk
  icon drawn on the board for the idea of the moment (icon: lightbulb | brain | arrow | question | clock | dollar | heart |
  eye | gear | target | chart | person | fire | star | check | cross | book | phone | key | cloud) with 1-3 words beside
  it; board = a clip or a quote pinned on the chalkboard with the line written under it in chalk (inner = the words as
  the source itself captioned them, source = who said it); phones = 1-3 short posts/videos as phone cards stacking up, then the episode's serif title typed; comment
  = one real comment or post, the key phrases highlighted one after another (marks = 1-3 exact phrases from text); scroll
  = 2-4 real headlines scrolling by (bold = words to bold); mosaic = two pixelated pictures popping in with a caption,
  for a joke about what cannot be shown; sources = 2-4 real sources or figures listed with a typing cursor.""",
    },
    "atlas": {
        "label": "ATLAS",
        "fonts": [("Kit Comic", "Bangers.ttf", "400", "normal"), ("Kit Round", "LilitaOne.ttf", "400", "normal"),
                  ("Kit Hand", "PatrickHand.ttf", "400", "normal")],
        "palette": {"paper": "#F3E3B3", "ink": "#2A1D12", "red": "#D93B2B", "green": "#6DB33F", "blue": "#3B8BD9",
                    "yellow": "#F2C230", "purple": "#8E5BC7", "orange": "#EE8A2E"},
        "types": {"timemachine": 6.0, "flipchart": 7.0, "watch": 3.8, "stamp": 3.8, "wave": 2.4, "scoreboard": 6.0,
                  "signpost": 4.5},
        "prompt": """- graphic — an ATLAS cartoon graphic (2-7 s), one of:
  {"tool": "graphic", "cue": 2, "words": "two thousand years ago", "type": "timemachine", "from_year": 2026, "to_year": -753, "label": "Rome is founded"}
  {"tool": "graphic", "cue": 6, "words": "...", "type": "flipchart", "pages": [{"year": "753 BC", "label": "A VILLAGE", "colour": "green"}, {"year": "509 BC", "label": "THE REPUBLIC", "colour": "blue"}, {"year": "27 BC", "label": "THE EMPIRE", "colour": "red"}]}
  {"tool": "graphic", "cue": 9, "words": "...", "type": "watch", "year": "1912"}
  {"tool": "graphic", "cue": 1, "words": "...", "type": "stamp", "text": "HISTORICALLY FACTS", "sub": "PART 19"}
  {"tool": "graphic", "cue": 12, "words": "...", "type": "wave", "colour": "yellow"}
  {"tool": "graphic", "cue": 15, "words": "...", "type": "scoreboard", "left": {"name": "ROME", "value": 80000, "unit": "soldiers", "colour": "red"}, "right": {"name": "CARTHAGE", "value": 50000, "unit": "soldiers", "colour": "blue"}}
  {"tool": "graphic", "cue": 18, "words": "...", "type": "signpost", "arrows": [{"text": "GAUL", "dir": "left"}, {"text": "EGYPT", "dir": "right"}, {"text": "BRITANNIA", "dir": "left"}]}
  timemachine = the time-travel bar when the story jumps in time (years as numbers, BC negative); flipchart = 2-4 eras,
  rulers, dynasties or stages as flipped pages, each with its year, its name and a colour (green|blue|red|yellow|purple|
  orange); watch = a wristwatch showing the year the story lands in; stamp = the bouncy title card of an episode or a
  part; wave = a paint wipe between two eras or places (yellow|red|blue|green); scoreboard = two sides compared with real
  numbers counting up; signpost = the places the story could go next or the roads out of a place.""",
    },
    "deep": {
        "label": "DEEP",
        "fonts": [("Kit Stencil", "SairaStencilOne.ttf", "400", "normal"), ("Kit Cond", "BarlowCondensed-SemiBold.ttf", "600", "normal"),
                  ("Kit Cond", "BarlowCondensed-Bold.ttf", "700", "normal"), ("Kit Cond", "BarlowCondensed-SemiBoldItalic.ttf", "600", "italic"),
                  ("Kit Mono", "SpaceMono-Bold.ttf", "700", "normal")],
        "palette": {"teal": "#0E3B45", "deep": "#08252C", "orange": "#E8532A", "cyan": "#4FE3FF", "ink": "#D7E9EC",
                    "red": "#FF3B30"},
        "types": {"stencil": 4.5, "route": 7.0, "cutaway": 6.0, "sonar": 5.5, "readout": 6.0, "maproom": 7.0},
        "prompt": """- graphic — a DEEP graphic (4-7 s), one of:
  {"tool": "graphic", "cue": 1, "words": "October 1971", "type": "stencil", "line1": "OCTOBER", "line2": "1971", "note": "Sea of Okhotsk"}
  {"tool": "graphic", "cue": 5, "words": "...", "type": "route", "from": "VLADIVOSTOK", "to": "PETROPAVLOVSK", "label": "the cable", "unit": "1,200 km"}
  {"tool": "graphic", "cue": 9, "words": "...", "type": "cutaway", "shape": "submarine", "label": "USS HALIBUT", "figures": 9, "red": 2, "note": "two divers in the bell"}
  {"tool": "graphic", "cue": 13, "words": "...", "type": "sonar", "title": "CONTACT", "contacts": [{"bearing": 40, "range": 0.6, "label": "K-129"}, {"bearing": 210, "range": 0.35, "label": "escort"}]}
  {"tool": "graphic", "cue": 17, "words": "...", "type": "readout", "title": "OPERATION IVY BELLS", "classification": "TOP SECRET", "rows": [{"k": "DEPTH", "v": "120 m"}, {"k": "CREW", "v": "140"}, {"k": "RECORDER", "v": "6 t, nuclear"}]}
  {"tool": "graphic", "cue": 21, "words": "...", "type": "maproom", "title": "SEA OF OKHOTSK", "grid": "A1-D4", "note": "the route of the Halibut"}
  stencil = a stencilled date, place or name over the footage (the way the story stamps a time); route = an abstract
  chart of a journey between two named points with a distance or a length; cutaway = a cross-section silhouette of a
  vessel, aircraft, rocket, station or building (shape: submarine | ship | plane | rocket | building | tunnel) with the
  crew as glowing figures and the ones the story follows in red; sonar = contacts on a sweeping screen (bearing 0-360,
  range 0-1); readout = a classified file of 3-5 real facts; maproom = the wall map of a headquarters the camera pushes
  into, for the plan of an operation.""",
    },
    "frontline": {
        "label": "NEWS",
        "fonts": [("Kit Black", "ArchivoBlack.ttf", "400", "normal"), ("Kit Cond", "Oswald.ttf", "200 700", "normal"),
                  ("Kit Ital", "BarlowCondensed-SemiBoldItalic.ttf", "600", "italic"), ("Kit Body", "Inter-SemiBold.ttf", "600", "normal"),
                  ("Kit Body", "Inter-Bold.ttf", "700", "normal")],
        "palette": {"paper": "#EEF0F2", "ink": "#101214", "red": "#E0322B", "yellow": "#F5C400", "cyan": "#BFE8E6",
                    "salmon": "#E9A6A0"},
        "types": {"newsbar": 6.0, "timeline": 7.0, "label": 3.8, "arrows": 6.0, "ticker": 5.5, "count": 5.0},
        "prompt": """- graphic — a NEWS graphic (4-6 s), one of:
  {"tool": "graphic", "cue": 3, "words": "...", "type": "newsbar", "tag": "BREAKING NEWS", "text": "Foreign Secretary says \\"we must make sure we are doing all we can\\"", "source": "Sky News, 24 Feb 2022"}
  {"tool": "graphic", "cue": 7, "words": "...", "type": "timeline", "note": "how it escalated", "events": [{"date": "FEB 2022", "text": "Russian troops cross the border"}, {"date": "SEP 2022", "text": "Kharkiv counteroffensive"}, {"date": "JUN 2023", "text": "Kakhovka dam destroyed"}, {"date": "AUG 2024", "text": "Ukraine enters Kursk"}]}
  {"tool": "graphic", "cue": 10, "words": "...", "type": "label", "text": "KYIV", "sub": "capital, 2.9 million"}
  {"tool": "graphic", "cue": 13, "words": "...", "type": "arrows", "title": "THREE AXES", "arrows": [{"from": "BELARUS", "to": "KYIV"}, {"from": "DONBAS", "to": "KHARKIV"}, {"from": "CRIMEA", "to": "KHERSON"}], "hot": ["KYIV", "KHARKIV"]}
  {"tool": "graphic", "cue": 16, "words": "...", "type": "ticker", "headline": "RUSSIAN FORCES ARE CLOSE TO KYIV", "items": ["Zelensky: fate of Ukraine being decided right now", "EU agrees new sanctions", "NATO holds emergency summit"], "time": "9:01 PM ET"}
  {"tool": "graphic", "cue": 20, "words": "...", "type": "count", "value": "190000", "unit": "troops on the border", "source": "US intelligence estimate, Feb 2022", "trend": [30, 45, 60, 90, 130, 190]}
  newsbar = a real quote or claim from a real report as a lower third over the footage (tag: BREAKING NEWS | LIVE |
  DEVELOPING | ANALYSIS); timeline = 3-5 real dated events with a short line each, for what happened when;
  label = a boxed place name pinned on the footage; arrows = 2-4 movements between named places on a relief ground, hot =
  the places under pressure; ticker = a news headline with a crawling ticker of 2-4 real items and a time; count = one
  real figure counting up with its unit, source and 3-8 trend values.""",
    },
    "legend": {
        "label": "LEGEND",
        "fonts": [("Kit Num", "BebasNeue.ttf", "400", "normal"), ("Kit Serif", "DMSerifDisplay.ttf", "400", "normal"),
                  ("Kit Text", "Lora.ttf", "400 700", "normal"), ("Kit Text", "Lora-Italic.ttf", "400 700", "italic"),
                  ("Kit Body", "Inter-SemiBold.ttf", "600", "normal")],
        "palette": {"cream": "#F4EBDD", "gold": "#C99A3B", "green": "#2F6B3A", "red": "#B0322A", "ink": "#1B1712"},
        "types": {"chapter": 4.8, "lower": 4.0, "scorecard": 6.0, "line": 5.5, "years": 5.5},
        "prompt": """- graphic — a LEGEND graphic (4-6 s), one of:
  {"tool": "graphic", "cue": 3, "words": "Fuzzy Zoeller", "type": "chapter", "n": 1, "name": "Fuzzy Zoeller", "note": "Masters champion, 1979", "subject": "Fuzzy Zoeller", "query": "Fuzzy Zoeller golfer portrait"}
  {"tool": "graphic", "cue": 6, "words": "...", "type": "lower", "name": "Tom Watson", "role": "8 major titles"}
  {"tool": "graphic", "cue": 10, "words": "...", "type": "scorecard", "title": "CROOKED STICK, 1991", "rows": [{"label": "Round 1", "value": "69"}, {"label": "Round 2", "value": "67"}, {"label": "Total", "value": "-12"}], "source": "PGA Championship"}
  {"tool": "graphic", "cue": 14, "words": "...", "type": "line", "line": "That's where you score.", "who": "John Daly"}
  {"tool": "graphic", "cue": 18, "words": "...", "type": "years", "years": [{"year": "1991", "label": "PGA Championship"}, {"year": "1995", "label": "The Open, St Andrews"}]}
  chapter = the numbered card for each person or item of the list, the first time they are named (n = their number,
  note = one real fact); lower = a name and a role over the footage the first time another real person appears; scorecard
  = 2-5 rows of real numbers (a round, a season, a record); line = one short sentence the narrator himself says in
  the script, as a card in his name; years = 2-5 real dated moments of a career.""",
    },
    "hustle": {
        "label": "HUSTLE",
        "fonts": [("Kit Pop", "Poppins-ExtraBold.ttf", "800", "normal"), ("Kit Pop", "Poppins-Bold.ttf", "700", "normal"),
                  ("Kit Pop", "Poppins-SemiBold.ttf", "600", "normal")],
        "palette": {"black": "#0B0B0D", "ink": "#FFFFFF", "red": "#E8232A", "yellow": "#FFD400", "green": "#2ED573",
                    "orange": "#F2892B"},
        "types": {"bar": 5.5, "icon3d": 4.5, "moneyrain": 4.5, "corner": 4.0, "counter": 5.0, "versus": 6.0, "checklist": 6.0},
        "prompt": """- graphic — a HUSTLE graphic (4-6 s), one of:
  {"tool": "graphic", "cue": 4, "words": "...", "type": "bar", "label": "DIFFICULTY LEVEL:", "value": 11, "max": 14}
  {"tool": "graphic", "cue": 2, "words": "finding a niche", "type": "icon3d", "icon": "search", "word": "NICHE"}
  {"tool": "graphic", "cue": 1, "words": "...", "type": "moneyrain", "text": "$4,200 / month"}
  {"tool": "graphic", "cue": 7, "words": "...", "type": "corner", "top": "FINDING MY", "bottom": "NICHE"}
  {"tool": "graphic", "cue": 11, "words": "...", "type": "counter", "value": 4200, "prefix": "$", "label": "in the first month", "note": "before tax"}
  {"tool": "graphic", "cue": 15, "words": "...", "type": "versus", "a": {"name": "DROPSHIPPING", "stats": [{"label": "startup cost", "value": 3}, {"label": "time to first sale", "value": 6}, {"label": "competition", "value": 9}]}, "b": {"name": "FREELANCING", "stats": [{"label": "startup cost", "value": 1}, {"label": "time to first sale", "value": 3}, {"label": "competition", "value": 7}]}}
  {"tool": "graphic", "cue": 19, "words": "...", "type": "checklist", "title": "WHAT YOU NEED", "items": ["a laptop", "one skill", "30 days"]}
  bar = a rating of something on a segmented bar (difficulty, risk, profit) with value out of max; icon3d = a glossy icon
  (search | dollar | rocket | bulb | chart | clock | fire | lock) with one word; moneyrain = money raining over the
  footage with a figure; corner = the two-line title of a section in the corner; counter = a figure counting up with a
  label; versus = two options compared on 2-4 stats scored 1-10; checklist = 2-5 items ticked one by one.""",
    },
    "analog": {
        "label": "ANALOG",
        "fonts": [("Kit Head", "InterDisplay-Black.ttf", "900", "normal"), ("Kit Cond", "BarlowCondensed-Bold.ttf", "700", "normal"),
                  ("Kit Mono", "SpaceMono-Bold.ttf", "700", "normal"), ("Kit Serif", "DMSerifDisplay.ttf", "400", "normal"),
                  ("Kit Body", "Inter-SemiBold.ttf", "600", "normal"), ("Kit LED", "ShareTechMono.ttf", "400", "normal")],
        "palette": {"red": "#E1382C", "orange": "#F28A1E", "yellow": "#F2C12E", "ivory": "#EDE4D3", "ink": "#F4EFE6",
                    "dim": "#8C8A86", "panel": "#18181B", "paper": "#EFE7D8", "dark": "#0E0E10"},
        "types": {"machine": 6.5, "steps": 7.5, "wave": 5.6, "record": 6.0, "price": 6.2, "units": 5.8, "timeline": 6.8,
                  "quote": 6.8, "city": 4.8},
        "prompt": """- graphic — an ANALOG graphic (5-8 s), one of:
  {"tool": "graphic", "cue": 3, "words": "...", "type": "machine", "name": "TR-808", "maker": "Roland Corporation · Osaka", "sub": "Rhythm Composer", "specs": [{"k": "Released", "v": "1980"}, {"k": "Sounds", "v": "16 analog voices"}, {"k": "Steps", "v": "16 per pattern"}], "subject": "Roland TR-808", "query": "Roland TR-808 drum machine front panel photo"}
  {"tool": "graphic", "cue": 7, "words": "...", "type": "steps", "label": "A basic four-on-the-floor", "bpm": 112, "rows": {"BD": "x...x...x...x...", "SD": "....x.......x...", "CH": "x.x.x.x.x.x.x.x.", "CP": "............x..."}}
  {"tool": "graphic", "cue": 9, "words": "...", "type": "wave", "lanes": [{"label": "A real kick drum", "sound": "acoustic"}, {"label": "The 808 kick", "sound": "kick"}], "note": "One stops. The other keeps ringing."}
  {"tool": "graphic", "cue": 12, "words": "...", "type": "record", "title": "Planet Rock", "artist": "Afrika Bambaataa & the Soulsonic Force", "year": "1982", "label": "Tommy Boy Records", "note": "12-inch single", "subject": "Planet Rock record", "query": "Afrika Bambaataa Planet Rock 1982 12 inch single cover"}
  {"tool": "graphic", "cue": 15, "words": "...", "type": "price", "tags": [{"year": "1980", "price": "$1,000", "label": "In the shop"}, {"year": "1985", "price": "$100", "label": "Second hand"}], "stamp": ""}
  {"tool": "graphic", "cue": 18, "words": "...", "type": "units", "value": 10000, "label": "units made", "sub": "in three years", "stamp": "Discontinued"}
  {"tool": "graphic", "cue": 21, "words": "...", "type": "timeline", "events": [{"year": "1980", "text": "The machine comes out"}, {"year": "1982", "text": "The first hit record"}, {"year": "2008", "text": "An album named after it"}]}
  {"tool": "graphic", "cue": 24, "words": "...", "type": "quote", "text": "the exact words, as printed or said on record", "who": "Speaker Name", "role": "who they are", "year": "2015", "subject": "Speaker Name", "query": "Speaker Name portrait"}
  {"tool": "graphic", "cue": 27, "words": "Detroit", "type": "city", "city": "Detroit", "region": "Michigan, USA", "coords": "42.33° N · 83.05° W", "year": "1983", "note": ""}
  EVERY value comes from the script — the examples above only show the shape; never copy their numbers or names.
  machine = the machine (or any piece of gear) the first time it is on screen and again at its turning points: its real
  name, maker and city, a subtitle, 2-4 spec lines of real facts (year, price, sounds, weight...), and a photo search for
  it; steps = a 16-step pattern that PLAYS with real 808 sounds while it is on screen — rows BD (kick), SD (snare), CH
  (closed hat), OH (open hat), CP (clap), CB (cowbell), RS (rimshot), 16 characters of x and . each, a bpm; the label
  names what it is ("a typical electro beat", "the kick alone") — call it a specific record's pattern only when the
  script says so; use it when the narration explains how the machine is programmed or how a style of beat works;
  wave = how a sound looks (sound: acoustic | kick | snare | clap | cowbell | hat | open), one or two lanes, one short
  note; record = a real record (single or album) the first time the narration names it, with its real year and label and
  a cover search; price = 2-3 real prices of the same thing over time, oldest first (the older ones get struck through),
  stamp optional; units = one real count (made, sold) counting up with a stamp; timeline = 3-5 real dated moments;
  quote = a real sentence someone said or wrote, word for word, with who and when — never invented, never paraphrased
  into quotation marks; city = the first time the story moves to a city (real coordinates, the year of the scene).""",
    },
    "tape": {
        "label": "TAPE",
        "fonts": [("Kit Black", "Montserrat-Black.ttf", "900", "normal"), ("Kit Bold", "Montserrat-ExtraBold.ttf", "800", "normal"),
                  ("Kit Semi", "Inter-SemiBold.ttf", "600", "normal"), ("Kit Mono", "SpaceMono-Bold.ttf", "700", "normal"),
                  ("Kit Body", "Inter-SemiBold.ttf", "600", "normal")],
        "palette": {"ink": "#FFFFFF", "red": "#FF0033", "dim": "#9AA0A6", "card": "#17181C"},
        "types": {"title": 4.5, "player": 6.0, "subs": 5.5, "post": 6.0, "timeline": 7.0, "quote": 6.0, "versus": 6.0, "chapter": 4.0},
        "prompt": """- graphic — a TAPE graphic (4-7 s), one of:
  {"tool": "graphic", "cue": 1, "words": "...", "type": "title", "text": "How MrBeast Changed YouTube Forever", "mark": "Forever", "tag": "VIDEO ESSAY", "sub": "the story of the biggest channel on earth"}
  {"tool": "graphic", "cue": 3, "words": "...", "type": "player", "channel": "MrBeast", "subs": "300M", "title": "I Gave People $1,000,000 But ONLY 1 Minute To Spend It!", "views": "180000000", "length": "12:41"}
  {"tool": "graphic", "cue": 6, "words": "...", "type": "subs", "channel": "MrBeast", "value": "300000000", "label": "subscribers", "when": "June 2024", "trend": [1, 4, 20, 60, 130, 220, 300]}
  {"tool": "graphic", "cue": 9, "words": "...", "type": "post", "who": "MrBeast", "handle": "@MrBeast", "platform": "X", "text": "I want to make the best videos on the planet. That's it.", "marks": ["best videos on the planet"], "when": "Mar 2, 2023", "likes": "412K"}
  {"tool": "graphic", "cue": 12, "words": "...", "type": "timeline", "title": "the uploads that changed it", "events": [{"date": "2017", "text": "Counting to 100,000", "length": "40:03:00"}, {"date": "2018", "text": "$1,000,000 in 24 hours", "length": "10:22"}, {"date": "2021", "text": "Squid Game in real life", "length": "25:41"}]}
  {"tool": "graphic", "cue": 15, "words": "...", "type": "quote", "text": "I'd rather have one great video than a hundred good ones.", "who": "MrBeast", "where": "Colin and Samir, 2022"}
  {"tool": "graphic", "cue": 18, "words": "...", "type": "versus", "left": {"name": "MrBeast", "value": "300000000", "note": "started 2012, Greenville NC"}, "right": {"name": "PewDiePie", "value": "111000000", "note": "started 2010, Gothenburg"}, "unit": "subscribers"}
  {"tool": "graphic", "cue": 21, "words": "...", "type": "chapter", "n": 2, "text": "The money problem", "sub": "part two"}
  title = the episode's opener on the very first cue (text = the episode title, mark = its key word in red, sub = one
  line on what it is about); player = a real video of the story in a player window with its channel plate: the channel, its subscriber count, the
  video's real title, its views and length; subs = one real subscriber or view figure of one channel rolling up, with
  when it was reached and 3-8 trend values; post = one real post or tweet as a card (exact words; marks = 1-3 exact
  phrases to highlight); timeline = 3-5 dated uploads or moments of one creator with a short line each and a video
  length; quote = a real quote, who said it and where; versus = two channels or two years of one channel side by side
  on one figure; chapter = a numbered section title.""",
    },
    "pulse": {
        "label": "PULSE",
        "fonts": [("Kit Sans", "InterVar.ttf", "100 900", "normal"), ("Kit Mono", "SpaceMono-Bold.ttf", "700", "normal"),
                  ("Kit Serif", "EB-Garamond-Italic.ttf", "400", "italic")],
        "palette": {"black": "#0D0D0D", "ink": "#FFFFFF", "paper": "#FFFFFF", "orange": "#FF6D24",
                    "pink": "#E58CA3", "lime": "#BEF242", "bar": "#47474B", "dim": "#8A8A8E"},
        "types": {"namecard": 4.6, "annot": 6.5, "bench": 6.5, "multiplier": 3.8, "logo": 3.6, "post": 7.0,
                  "grid": 6.0, "hud": 6.0, "bigline": 4.2, "typecard": 3.4, "spec": 5.5, "versus": 6.2,
                  "board": 8.0, "snap": 5.0, "tally": 5.6, "hand": 6.8, "race": 6.4, "chat": 8.5, "pricecut": 4.6, "breakout": 6.0, "leaderboard": 5.8, "timeline": 6.0, "flip": 3.4, "context": 5.4, "quote": 6.2, "picker": 4.4, "stats": 4.8, "eval": 5.4, "phone": 6.0, "ticker": 5.0, "breach": 9.0},
        # the shortest each scene still plays in full: its one beat has landed and been
        # read. The director shortens a graphic to this before it drops it for overlap —
        # without it PULSE lost seven scenes in one 2-minute sample.
        "min_s": {"typecard": 2.2, "logo": 2.4, "namecard": 3.0, "snap": 3.4, "bench": 4.2, "multiplier": 3.0,
                  "spec": 3.6, "versus": 4.2, "post": 4.5, "annot": 4.5, "board": 6.6, "bigline": 3.0,
                  "hud": 4.2, "grid": 4.6, "tally": 4.4, "hand": 5.6, "race": 5.4, "chat": 6.5, "pricecut": 3.6, "breakout": 5.0, "leaderboard": 4.2, "timeline": 4.5, "flip": 2.4, "context": 4.2, "quote": 4.6, "picker": 3.9, "stats": 3.6, "eval": 4.4, "phone": 4.8, "ticker": 3.8, "breach": 7.0},
        "prompt": """- graphic — a PULSE graphic (3-7 s), one of:
  {"tool": "graphic", "cue": 2, "words": "...", "type": "typecard", "text": "Grok 4.7", "sub": "xAI's most capable model yet"}
  {"tool": "graphic", "cue": 4, "words": "...", "type": "logo", "name": "OpenAI", "line": "a new model for legal work", "tag": "UPDATE 07"}
  {"tool": "graphic", "cue": 7, "words": "...", "type": "namecard", "name": "Diogo Almeida", "role": "co-inventor of ChatGPT\\nfounder, TypeSafe AI", "subject": "Diogo Almeida", "query": "Diogo Almeida TypeSafe AI"}
  {"tool": "graphic", "cue": 9, "words": "...", "type": "snap", "name": "xAI", "line": "Grok 4.7 is finally here", "subject": "Elon Musk", "query": "Elon Musk xAI presentation"}
  {"tool": "graphic", "cue": 10, "words": "...", "type": "tally", "prefix": "$", "value": 0.10, "decimals": 2, "caption": "per million input tokens", "tag": "GPT-6 LUNA"}
  {"tool": "graphic", "cue": 21, "words": "...", "type": "eval", "title": "Damo Radar against radiologists", "tag": "ALIBABA · DAMO RADAR", "total": 26, "solved": 23, "unit": "radiologists outperformed"}
  {"tool": "graphic", "cue": 27, "words": "...", "type": "phone", "app": "Claude", "company": "Anthropic", "model": "Claude Opus 5.5", "prompt": "Explain in two sentences why a cheaper model can cost more to run.", "caption": "Now on your phone"}
  {"tool": "graphic", "cue": 23, "words": "...", "type": "ticker", "items": [{"name": "Claude Opus 5.5", "company": "Anthropic", "line": "$4 per 1M input"}, {"name": "GPT-6 Sol + Luna", "company": "OpenAI", "line": "half the price"}, {"name": "Gemini", "company": "Google Gemini", "line": "3 systems breached"}, {"name": "Damo Radar", "company": "Alibaba", "line": "146 conditions"}], "focus": 1}
  {"tool": "graphic", "cue": 23, "words": "...", "type": "stats", "title": "this week in numbers", "items": [{"prefix": "$", "value": 4, "label": "Claude Opus 5.5 per million input tokens", "hot": true}, {"prefix": "$", "value": 0.10, "dec": 2, "label": "GPT-6 Luna per million input tokens"}, {"value": 3, "label": "companies Gemini got into"}, {"value": 146, "label": "conditions Damo Radar reads"}]}
  {"tool": "graphic", "cue": 11, "words": "...", "type": "picker", "product": "GitHub Copilot", "company": "GitHub", "current": "Auto", "models": [{"name": "GPT-6 Sol", "new": true}, {"name": "GPT-6 Luna", "new": true}], "pick": 0}
  {"tool": "graphic", "cue": 14, "words": "...", "type": "context", "tokens": 1000000, "caption": "GPT-6 Sol and Luna's context window", "tag": "GPT-6 SOL · LUNA"}
  {"tool": "graphic", "cue": 10, "words": "...", "type": "quote", "text": "GPT-6 Sol makes about half as many mistakes as its predecessor, reaching Astra-level reliability at much lower cost.", "mark": "half as many mistakes", "who": "OpenAI", "role": "GPT-6 Sol announcement", "subject": "Sam Altman", "query": "Sam Altman OpenAI"}
  {"tool": "graphic", "cue": 30, "words": "...", "type": "flip", "n": 5, "of": 12, "name": "GPT-6 Sol", "company": "OpenAI", "line": "half the price, half the mistakes"}
  {"tool": "graphic", "cue": 12, "words": "...", "type": "leaderboard", "title": "Terminal-Bench 4.0", "sub": "agentic coding", "rows": [{"name": "Claude Opus 5.5", "company": "Anthropic", "score": 66.4, "dec": 1}, {"name": "Claude Fable 5.1", "company": "Anthropic", "score": 55.8, "dec": 1}], "hot": 0, "from": 2, "old": 55.8}
  {"tool": "graphic", "cue": 24, "words": "...", "type": "timeline", "title": "The end of Sora", "sub": "OpenAI's video model, 2026", "events": [{"date": "Mar 24", "label": "Sora API end date announced"}, {"date": "Apr 26", "label": "Sora app shut down"}, {"date": "Sep 24", "label": "Sora API switched off"}]}
  {"tool": "graphic", "cue": 3, "words": "...", "type": "pricecut", "prefix": "$", "from": 5, "to": 4, "caption": "per million input tokens", "tag": "CLAUDE OPUS 5.5"}
  {"tool": "graphic", "cue": 3, "words": "...", "type": "breach", "company": "OpenAI", "agent": "OpenAI agent", "gate": "Medicare portal", "public": "statistics reports", "files": "aggregate statistics, internal file names", "safe": "No patient records were touched", "tries": 3}
  {"tool": "graphic", "cue": 16, "words": "...", "type": "breakout", "company": "Google Gemini", "inner": "Gemini", "box": "test sandbox", "gap": "internet left open", "net": "live internet", "outer": ["Company 1", "Company 2", "Company 3"]}
  {"tool": "graphic", "cue": 27, "words": "...", "type": "chat", "model": "Claude Opus 5.5", "company": "Anthropic", "prompt": "Explain in two sentences why a cheaper model can cost more to run."}
  {"tool": "graphic", "cue": 25, "words": "...", "type": "race", "a": "Claude Opus 5.5", "b": "GPT-6 Sol", "task": "build a playable snake game in one HTML file", "chip": "Who finishes?", "chip_sub": "at the end of the video"}
  {"tool": "graphic", "cue": 23, "words": "...", "type": "hand", "cards": [{"name": "Claude Opus 5.5", "company": "Anthropic", "tag": "Anthropic", "line": "$4 / $20 per 1M"}, {"name": "GPT-6 Sol", "company": "OpenAI", "tag": "OpenAI", "line": "$2 / $10 per 1M"}, {"name": "Gemini", "company": "Google Gemini", "tag": "Google", "line": "3 companies breached"}, {"name": "Damo Radar", "company": "Alibaba", "tag": "Alibaba", "line": "146 conditions"}], "hero": 1, "title": "Next: GPT-6 Sol", "text": "Half the price of the model it replaces."}
  {"tool": "graphic", "cue": 11, "words": "...", "type": "bench", "title": "Professional knowledge work", "sub": "GDPval", "axis": "Elo score", "rows": [{"label": "Fable 5.1", "note": "(max)", "value": 1735}, {"label": "Grok 4.7", "note": "(xhigh)", "value": 1695, "hot": true}, {"label": "GPT-6 Astra", "note": "(max)", "value": 1542}]}
  {"tool": "graphic", "cue": 15, "words": "...", "type": "multiplier", "from": 46, "to": 99, "suffix": "x", "unit": "faster", "caption": "than a frontier chat model on the same task"}
  {"tool": "graphic", "cue": 18, "words": "...", "type": "spec", "title": "what it costs to run", "items": [{"label": "latency", "value": 70, "suffix": "ms", "note": "to first token", "hot": true}, {"label": "input", "value": 42, "prefix": "$", "note": "per billion tokens"}, {"label": "output", "value": 0, "prefix": "$", "note": "free"}]}
  {"tool": "graphic", "cue": 22, "words": "...", "type": "versus", "a": "Gemini 3.8 Live", "b": "GPT-6 Astra", "rows": [{"label": "languages", "av": "97", "bv": "58", "win": "a"}, {"label": "interruptions", "av": "handled", "bv": "no", "win": "a"}, {"label": "price / 1M", "av": "$2.10", "bv": "$1.40", "win": "b"}]}
  {"tool": "graphic", "cue": 26, "words": "...", "type": "post", "who": "Diogo Almeida", "handle": "@CompleteSkeptic", "when": "3h", "text": "After co-inventing ChatGPT, I kept asking myself: why have superhuman chat models not led to AGI?", "marks": ["superhuman", "AGI"], "bullets": ["20-200x faster", "40-400x cheaper"]}
  {"tool": "graphic", "cue": 30, "words": "...", "type": "annot", "line": "The answer was obviously not more scale.", "marks": ["more scale"], "label": "AGI?"}
  {"tool": "graphic", "cue": 32, "words": "...", "type": "board", "call": "AGI?", "line": "The answer was obviously not", "turn": "But", "line2": "The $ trillion-dollar question is"}
  {"tool": "graphic", "cue": 34, "words": "...", "type": "bigline", "line": "A new type of foundation model", "key": "new", "subject": "server racks in a data centre", "query": "AI data centre servers"}
  {"tool": "graphic", "cue": 38, "words": "...", "type": "hud", "who": "Diogo Almeida", "role": "founder of TypeSafe AI", "n": "01", "of": "12", "subject": "Diogo Almeida", "query": "Diogo Almeida interview"}
  {"tool": "graphic", "cue": 1, "words": "...", "type": "grid", "count": 12, "head": "12 AI Updates", "headItalic": "for this", "headTail": "Week", "note": "Timestamps are in the description"}
  typecard = the name of a model or company, typed on black, before its section starts; logo = the company's OFFICIAL
  logo (name = the company exactly as it is written: OpenAI, xAI, Anthropic, Google Gemini, Alibaba, Qwen, Meta,
  Microsoft, Perplexity, Nvidia, DeepSeek, Mistral) with one line under it — use this the first time each company is
  named; namecard = the person behind an update, their real photo with their name run off the frame edge (subject +
  query fetch the photo; role may hold two lines split by \\n); snap = the SHUTTER: a real photo of the person most
  associated with the company (Sam Altman for OpenAI, Elon Musk for xAI/Grok, Demis Hassabis for DeepMind/Gemini,
  Dario Amodei for Anthropic, Mark Zuckerberg for Meta, Jensen Huang for Nvidia) flashes white, the shot pushes
  right and the company's mark rises in beside them — `name` is the COMPANY (for the mark), `line` is one short
  sentence, `subject`+`query` fetch the person's photo. Use it when a company's launch is announced and a face
  makes it land; eval = a published pass count as a grid filling (`solved` of `total`, title, tag) — the cell order is scrambled,
  so it never claims WHICH item failed; phone = the model answering in a phone app — `model` + `prompt` like chat, the
  reply is the model's REAL one; ticker = this week's updates running past and stopping on `focus` (items: name,
  company, line) — for a transition or a roundup; stats = up to four REAL figures in a grid counting up (prefix/value/dec/suffix or text, label, hot on the lead one) —
  for a recap or a hook that stacks several numbers; picker = "it is in the product now": a generic app window whose model menu opens and the cursor picks `pick` —
  `product` (and `company` for its mark), `models` = ONLY models the narration says it offers ({name, new, note});
  context = a context-window claim: `tokens` (the real length), caption, tag, optional `marks` [{at, label}] only for
  comparisons the script itself makes; quote = WORDS SOMEONE ACTUALLY SAID OR PUBLISHED, verbatim (`text`), `mark` = the
  exact phrase that matters, `who`/`role`, and subject+query for the speaker's photo — never a paraphrase in quotes;
  flip = the turn into the NEXT update of a roundup: a split-flap counter turning to `n` / `of`, then the update's mark
  (`company`) and `name` — on the first words of each new section, never mid-section; leaderboard = a PUBLISHED ranking (rows in their final order, 2-7): the `hot` row (0-based) climbs from rank `from`
  (1-based) to its place, its score counting from `old` — only real standings from a named table; timeline = 2-6 REAL
  dated events in order, the camera travelling to the last one (the news) — for a story that is a sequence of dates;
  pricecut = a price that FELL: `from` struck through in orange and pushed aside, `to` dropping in, the saving
  counting up in a chip (prefix/decimals/suffix, caption, tag) — only for a real old and new price;
  breach = an agent getting IN where it was refused: requests bounce off the gate (`tries`), then a line goes round it
  to the non-public `files`; `safe` = what was NOT reached, only as reported — for an unauthorised-access story;
  breakout = how a model got out: a dashed sandbox, the line through the gap (`gap`) to the internet (`net`), branching
  to each system reached (`outer`, numbered when the companies are not named) — for a containment or security story,
  never a hacker picture; chat = a chat window where `model` answers `prompt` — ONLY where the narration says the model was asked or tested
  ("I asked Opus 5.5…"); the pipeline runs the prompt on that model and shows its REAL reply, so write only the prompt;
  race = two models on the SAME task, both streaming at the same pace, frozen a frame before the finish with a
  chip — ONLY for a head-to-head the video promises to settle later ("at the end I put A and B on the same task"); it never
  shows a winner; hand = the week's cards: 3-5 cards (name = the model, company = for its official mark, tag = the
  company as written, line = its one figure), dealt and fanned, then card `hero` (0-based; -1 = no pull) is flown to the lens
  and `title` + `text` rise beside it — for a roundup ("four of this week's updates") or the turn into the next section;
  tally = ONE figure rung up on spinning drums, the camera pulling back from one digit to the whole
  number — prefix/value/decimals/suffix (or text for a figure like "23/26"), caption = what it counts, tag = the model or
  company in capitals; use it for the single figure a section turns on (a price, a count, a score) — never two in a row; bench = a REAL benchmark with 3-5 models, hot:true on
  the one this update is about (only real scores, and say which benchmark in sub); multiplier = one figure counting
  from `from` to `to` — use it for a speed or price claim the script actually makes; spec = 2-4 real figures of a
  launch (latency, price, context, parameters), hot:true on the headline one; versus = two models compared on 2-4
  rows, win = "a" | "b" | "" per row; post = one REAL post (exact words; marks = 1-3 exact phrases from text to
  highlight, bullets optional); annot = one sentence of the argument on a white page, marks = the phrase to box,
  label = the short question hanging off the leader line; board = the same argument WRITTEN on a notebook grid, the
  camera following the pen: call = the question in the box, line = what is written first, then line2 = the answer
  under a black `turn` chip (leave line2 out to hold on one line, and a $ inside a line is drawn as a money bag) —
  use board when the sentence turns on itself, annot when a phrase inside one sentence is the point; bigline = a statement over footage with key = the one word
  in pink; grid = the contents of the episode, ONLY on the first cue of the video.""",
    },
    "almanac": {
        "label": "ALMANAC",
        "fonts": [("Kit Sans", "InterVar.ttf", "100 900", "normal")],
        # the inks the scenes print with (core.js ALM measured them off the references; only red is read from here)
        "palette": {"page": "#FFFFFF", "bar": "#2B2B2B", "yellow": "#F8D848", "sub": "#111111", "charcoal": "#282828",
                    "card": "#0E0E0E", "mustard": "#E6BE61", "stripe": "#262626", "paper": "#F3F1ED",
                    "ink": "#151515", "engraved": "#CAC4BC", "red": "#C8372D"},
        "types": {"bar": 5.1, "card": 5.1, "reel": 9.6, "hand": 6.4, "tally": 6.8, "cardwall": 7.1, "register": 5.6},
        # the shortest each scene still plays in full (the film strip needs its spin-down and its dive, the hand its
        # pull): a scene is never cut below this to make room for the next one — the next one is left out instead
        "min_s": {"bar": 3.4, "card": 3.6, "reel": 6.6, "hand": 5.6, "tally": 5.0, "cardwall": 5.6, "register": 5.0},
        "prompt": """- graphic — an ALMANAC graphic (5-10 s), one of:
  {"tool": "graphic", "cue": 3, "words": "...", "type": "bar", "name": "Al Capone", "sub": "Born 17 January 1899 · Brooklyn, New York", "subject": "Al Capone", "query": "Al Capone 1930 portrait photograph"}
  {"tool": "graphic", "cue": 5, "words": "...", "type": "card", "title": "ROVER V8", "text": "Buick's all-aluminium V8, bought by Rover in 1965. It went on to power the Range Rover and the MGB GT V8.", "thing": "Rover V8 engine"}
  {"tool": "graphic", "cue": 1, "words": "...", "type": "reel", "title": "PROHIBITION", "text": "17 January 1920. Making, selling or transporting intoxicating liquor is now illegal in the United States.", "label": {"name": "Chicago", "sub": "the 1920s"}}
  {"tool": "graphic", "cue": 8, "words": "...", "type": "hand", "kicker": "The beer business", "title": "Chicago, 1925", "back": "The Capone Case", "cards": [{"name": "Dean O'Banion", "tag": "North Side", "role": "North Side boss. Shot dead, November 1924.", "subject": "Dean O'Banion", "query": "Dean O'Banion 1921 photograph"}, {"name": "Johnny Torrio", "tag": "The Fox", "role": "South Side boss. Shot, 24 January 1925.", "subject": "Johnny Torrio", "query": "Johnny Torrio photograph"}, {"name": "Al Capone", "tag": "The Heir", "role": "Takes over the Outfit in 1925. Age 26.", "subject": "Al Capone", "query": "Al Capone 1929 photograph"}], "hero": 2, "hero_title": "The boss at 26.", "hero_text": "Torrio survives a North Side ambush in January 1925, hands Capone the Outfit and leaves Chicago."}
  {"tool": "graphic", "cue": 11, "words": "...", "type": "tally", "value": 100000000, "prefix": "$", "headline": "a year · the whole operation's estimated gross, late 1920s", "source": "The Mob Museum", "subject": "Al Capone", "query": "Al Capone 1931 photograph"}
  {"tool": "graphic", "cue": 14, "words": "...", "type": "cardwall", "title": "FEB 14, 1929", "body": "Capone is at a hearing in the Dade County Solicitor's office in Miami. No one is ever charged with the killings.", "split_at": 0.8, "subject": "Al Capone", "query": "Al Capone Miami 1930 photograph"}
  {"tool": "graphic", "cue": 17, "words": "...", "type": "register", "title": "GUILTY", "kicker": "U.S. v. Alphonse Capone · October 1931", "subtitle": "$50,000 fine + $7,692 court costs", "stamp": "11 YEARS", "stamp_sub": "SENTENCED · 24 OCT. 1931", "subject": "Al Capone", "query": "Al Capone portrait 1930"}
  EVERY value comes from the script — the examples above only show the shape; never copy their names, dates or numbers.
  Pictures are real and fetched for you: subject + query find a real photo of a person (it is cut out of its
  background), thing names a real object to photograph and cut out; the film in reel, cardwall and tally is the
  video's own archive footage for those words. Never ask for a person who has no public photograph.
  bar = a real person the FIRST time they matter: the name rises in yellow on a dark bar beside their photo (name
  <= 22 characters, sub = one line of real fact: born, role, years, <= 60); card = a real THING the first time it is
  named — an object, a machine, a document, a building: title in capitals, <= 10 characters reads best (<= 14 fits),
  text = one or two sentences of real facts (<= 170 characters), thing = what to photograph (or subject + query for a
  person); reel = the opening of the video or of a new era, at most once every two minutes: title = one word or a year
  (<= 14 characters), text <= 150 characters dating the moment, label = the place the film lands in (name + a short
  sub) — it needs 9-10 s; hand = 2-5 people who share one moment (a gang, a cabinet, a band, a team, the sides of a
  case): name <= 18, tag 1-2 words, role <= 45 of real facts, hero = the index of the one the story follows next
  (-1 = none) with hero_title <= 60 and hero_text <= 140, title = a place and a year <= 18, kicker <= 30, back = the
  series or case name; tally = one big real figure the narration says: value as a plain number (prefix "$", suffix
  " tons" …) or text for a figure that is not one, headline = what it counts (<= 70), source, and subject + query for
  the person it belongs to (without a person it sets on the card: kicker, headline, body, and thing for an object
  such as the document); cardwall = a turning point in the story: the footage cracks into cards that turn into the
  person's card, title = a date or a short word (<= 12 characters), body <= 180 characters, subject + query for the
  person; register = the verdict the story has built to — a sentence, a sale, a ban, a record: title <= 7 characters
  (GUILTY, SOLD, BANNED, 1ST), kicker = the case or event (<= 60), subtitle = the figure (<= 50), stamp <= 10
  characters with stamp_sub, subject + query for the portrait. Never the same template twice in a row; reel,
  cardwall and register are the big moments — once or twice a video each.""",
    },
    "strata": {
        "label": "STRATA",
        # one family for every overlay (Montserrat, variable: labels 300-400 caps, titles 600-700); EB Garamond only
        # sets a paper's own page (paper_page) — a depicted object, not the channel's type
        "fonts": [("Kit Geo", "MontserratVar.ttf", "100 900", "normal"),
                  ("Kit Serif", "EB-Garamond.ttf", "400 800", "normal"),
                  ("Kit Serif", "EB-Garamond-Italic.ttf", "400 800", "italic")],
        # measured on the reference (learned/when-earth-had-supermountains/graphics); the scenes carry their own
        # exact inks (core.js STR), these are the named ones a scene may ask for
        "palette": {"ink": "#F2F9FE", "grey": "#848587", "black": "#000000", "night": "#070709", "charcoal": "#1E1D22",
                    "wall": "#1A373F", "floor": "#36757C", "ocean": "#21393B", "land": "#1B2A2D", "teal": "#0B3937",
                    "brown": "#6E4E39", "peach": "#E4B8B2", "cyan": "#D1EFF2", "tan": "#D9A06B"},
        "types": {"timescale": 6.0, "globe_ruler": 6.0, "specimen_card": 3.5, "caption": 6.0, "chart": 7.0,
                  "cross_section": 8.0, "study_timeline": 6.0, "team_card": 3.7, "paper_page": 5.5, "chapter": 4.6},
        # the shortest each scene still builds in full (measured: the last element in + a read)
        "min_s": {"timescale": 3.5, "globe_ruler": 4.0, "specimen_card": 2.4, "caption": 3.0, "chart": 3.2,
                  "cross_section": 4.0, "study_timeline": 2.9, "team_card": 2.3, "paper_page": 3.0, "chapter": 2.5},
        "prompt": """- graphic — a STRATA graphic (3-12 s), one of:
  {"tool": "graphic", "cue": 14, "words": "...", "type": "timescale", "view": "whole", "camera": [{"at": {"word": "Ediacaran"}, "to": "Ediacaran"}], "markers": [{"at": {"word": "550"}, "ma": 550, "text": "Cloudina appears / 550 million years ago"}]}
  {"tool": "graphic", "cue": 9, "words": "...", "type": "globe_ruler", "age_ma": 650, "age_label": "650 MILLION YEARS", "label_at": {"word": "650"}}
  {"tool": "graphic", "cue": 12, "words": "...", "type": "globe_ruler", "age_ma": 635, "age_label": "635 MILLION YEARS", "ice": "grow", "ice_at": {"word": "frozen"}, "dur": 7}
  {"tool": "graphic", "cue": 10, "words": "...", "type": "globe_ruler", "age_ma": 500, "morph_from_ma": 650, "age_label": "500 MILLION YEARS", "legend": "GONDWANA", "legend_at": {"word": "Gondwana"}, "entry": "cut", "dur": 11}
  {"tool": "graphic", "cue": 6, "words": "...", "type": "specimen_card", "title": "Zircon", "lines": ["CHEMICAL FORMULA: ZRSIO4", "MINERAL CLASS: NESOSILICATE", "CRYSTAL SYSTEM: TETRAGONAL"], "symbol": "ZrSiO4", "thing": "zircon crystal"}
  {"tool": "graphic", "cue": 7, "words": "...", "type": "caption", "lines": ["DATING BACK", "ROUGHLY 4.4 BILLION YEARS."], "thing": "Jack Hills zircon crystal"}
  {"tool": "graphic", "cue": 20, "words": "...", "type": "chart", "kind": "dots", "title": "Five continents, one fingerprint", "source": "DETRITAL ZIRCON U-PB AGES · AFTER SQUIRE ET AL. (2006)", "rows": ["INDIA", "AFRICA", "ANTARCTICA", "AUSTRALIA", "SOUTH AMERICA"], "x": {"min": 1300, "max": 500, "ticks": [1300, 1100, 900, 700, 500], "label": "AGE OF GRAIN", "label_left": "OLDER", "label_right": "YOUNGER"}, "bands": [{"range": [1200, 900], "label": "THE OLDER CROWD", "sub": "1200-900 MILLION YEARS AGO", "color": "teal"}, {"range": [650, 550], "label": "THE YOUNGER CROWD", "sub": "650-550 MILLION YEARS AGO", "color": "brown"}], "dur": 12}
  {"tool": "graphic", "cue": 31, "words": "...", "type": "cross_section", "style": "peach", "layers": ["CRUST", "MANTLE"], "dimension": {"text": "40-50 KM", "at": {"word": "40"}}, "callouts": ["LOW-LU ZIRCONS", {"text": "GARNET", "at": {"word": "garnet"}}]}
  {"tool": "graphic", "cue": 22, "words": "...", "type": "cross_section", "style": "sage", "layers": ["CRUST", "ASTHENOSPHERE", "MANTLE"], "root": {"grow": true}}
  {"tool": "graphic", "cue": 5, "words": "...", "type": "study_timeline", "studies": [{"year": 2006, "title": "Squire et al. (2006),", "subtitle": "Transgondwanan Supermountain", "ref": "Squire 2006 Did the Transgondwanan Supermountain trigger the explosive radiation of animals on Earth"}]}
  {"tool": "graphic", "cue": 6, "words": "...", "type": "team_card", "title": "Team", "members": [{"name": "Richard J. Squire", "role": "GEOLOGIST", "org": "UNIVERSITY OF MELBOURNE", "query": "Richard Squire geologist University of Melbourne"}, {"name": "Ian H. Campbell", "role": "GEOCHEMIST", "org": "AUSTRALIAN NATIONAL UNIVERSITY", "query": "Ian Campbell geochemist Australian National University"}]}
  {"tool": "graphic", "cue": 8, "words": "...", "type": "paper_page", "ref": "10.1016/j.epsl.2006.07.032", "presentation": "flat_black"}
  {"tool": "graphic", "cue": 33, "words": "...", "type": "paper_page", "ref": "Zhu 2022 The temporal distribution of Earth's supermountains", "presentation": "folder_charcoal"}
  EVERY value comes from the script — the examples above only show the shape; never copy their names, ages or numbers.
  A time field ("at", "label_at", "legend_at") is the word it lands on, {"word": "..."} copied from the narration, or
  seconds from the scene's start; leave it out and the scene keeps its own measured timing.
  timescale = a date or span in deep time the narration names ("550 million years ago", "the Ediacaran", "the
  Cambrian explosion"): the geologic time-scale band. view "whole" starts on all of Earth's history; camera = the unit
  it zooms to (an eon, era, period or epoch by its name, or [older, younger] in millions of years) on the word that
  names it; markers = the events (at most 5), ma = the real age in millions of years, on the word that says it,
  text = 1-3 short lines split by " / " (<= 28 characters each); brackets = up to 2 spans [{"from", "to" (Ma),
  "label"}]. At most one every minute.
  globe_ruler = the whole Earth at one moment in deep time — continents drifting, a supercontinent assembling or
  breaking apart: the REAL continents of that age (reconstructed plate positions) turn on a globe while a time ruler
  spins down to it. age_ma 0-1000, age_label in capitals ("650 MILLION YEARS"), morph_from_ma to show them moving from
  an earlier age, legend = the landmass that forms (<= 16 characters, on its word); a morph with a legend needs
  "dur": 9-11. ruler false = the plain large globe (a place on Earth, no age). ice "grow" = the planet freezing
  from the poles to the equator on the word ice_at (a global glaciation, Snowball Earth), "full" = already frozen,
  "melt" = the thaw; give it "dur": 7. Once or twice a video.
  specimen_card = a mineral, element, rock or fossil the FIRST time it is named, cut in on that sentence: title = its
  name in sentence case (<= 24), lines = 2-3 facts the narrator does NOT say, "LABEL: VALUE" in capitals (<= 34 each),
  symbol = its chemical symbol or formula when it has one, thing = what to photograph (a real specimen photo is cut
  out and set on the stage).
  caption = an object, specimen or reconstruction shown on its own: 1-2 lines in capitals (<= 40 characters) that
  name or date it, thing = what to photograph.
  chart = a measured result the script states. kind "dots": age ranges found in several places — rows = the places
  (2-8), bands = 1-4 ranges ({range: [older, younger] in millions of years, label, sub, color teal | brown | slate |
  olive}), x = the axis; "dur" = 5 + 3.6 per band (it punches in on each range as its numbers are said). kinds
  "line" (series [{label, points [[x, y], ...]}]) and "bars" (values per bin) ONLY with real values the script
  gives. title in sentence case (<= 60), source = the study in capitals (<= 170).
  cross_section = what lies under the surface while the narration explains it: style "sage" = a mountain range over
  its layers, root {"grow": true} when the mountain's root sinks into the mantle; style "peach" = a close cut through
  the crust with a depth line (dimension = the depth or thickness the script states, "40-50 KM") and callouts = 1-3
  things drawn in it (capitals). layers top to bottom, in capitals.
  study_timeline = a study introduced by its year ("In 2006, a team…"), held on screen while its people are named
  (default 6 s): 1-2 studies, each {year, title "Author et
  al. (year),", subtitle = a short form of the paper's title (<= 40), ref = the paper's DOI or its first author, year
  and title words} — the engine checks each one against the real paper and sets the citation from it.
  team_card = the researchers of a study, when the narration names them: 2-6 members {name as printed on the paper,
  role and org in capitals (<= 30 / 40), query = name + field + university for their real photo}; 5-6 members need
  "dur": 6.4. Real researchers of that paper only.
  paper_page = the sentence where the narration states what a study found: ref = the paper's DOI or its first author,
  year and title words. The engine sets the REAL page (title, authors, journal) and isolates the sentence of its
  abstract the narration is about (or its title when the publisher keeps the abstract back); never write a quote
  yourself. presentation "flat_black" (the page on black, two punch-ins) or "folder_charcoal" (the page in the
  study's folder with "The <year> Study" beside it) — the folder for a study already introduced by study_timeline.
  A study is told in this order: study_timeline on its year, team_card on its people, paper_page on its finding.
  Otherwise never the same type twice in a row.""",
    },
    # HORIZON — the data documentary (README-HORIZON.md). Its numbers come from horizon.py (World Bank, UN WPP): the
    # director names a series, never types a line of values. Own navy grounds; quote/docshot fetch a real picture.
    "horizon": {
        "label": "HORIZON",
        "fonts": [("PF", "PlayfairDisplay.ttf", "400 900", "normal"), ("PF", "PlayfairDisplay-Italic.ttf", "400 900", "italic"),
                  ("PO", "Poppins-Regular.ttf", "400", "normal"), ("PO", "Poppins-Medium.ttf", "500", "normal"),
                  ("PO", "Poppins-SemiBold.ttf", "600", "normal")],
        "palette": {"navy": "#070E14", "ink": "#F4F1EA", "red": "#E0434C", "amber": "#F2B84B"},
        "types": {"linechart": 9.0, "pyramid": 7.0, "gens": 9.5, "numroll": 4.6, "yearbars": 7.5, "hbars": 6.0,
                  "ticker": 5.5, "strike": 5.5, "quote": 7.0, "titlecard": 3.2, "docshot": 5.0, "readline": 5.2, "tab": 3.4},
        "min_s": {"linechart": 6.0, "pyramid": 5.0, "gens": 7.0, "numroll": 3.2, "yearbars": 5.0, "hbars": 4.2,
                  "ticker": 3.8, "strike": 4.0, "quote": 4.5, "titlecard": 2.4, "docshot": 3.4, "readline": 3.6, "tab": 2.4},
        "prompt": """- graphic — a HORIZON graphic (3-9 s). Every number on screen is REAL: name a World Bank series (country =
  ISO alpha-3, indicator = its code) or UN population figures and the engine fetches them, or copy a figure the script
  states. Never type a line of values yourself and never invent one. One of:
  {"tool": "graphic", "cue": 3, "words": "...", "type": "linechart", "country": "KOR", "indicator": "SP.DYN.TFRT.IN", "from": 1960, "to": 2023, "title": "Births per woman · South Korea", "ref": {"y": 2.1, "text": "2.1 — replacement level"}, "marks": [{"x": 1983, "kicker": "1983", "text": "below replacement"}, {"x": 2023, "kicker": "2023", "text": "0.72", "hot": true}]}
  {"tool": "graphic", "cue": 6, "words": "...", "type": "pyramid", "country": "KOR", "years": [1960, 2024, 2072], "hl": "old", "caption": "Nearly half the country over 65.", "title": "South Korea by age"}
  {"tool": "graphic", "cue": 8, "words": "...", "type": "gens", "rate": 0.72, "title": "Every hundred people"}
  {"tool": "graphic", "cue": 2, "words": "...", "type": "numroll", "from": "0.78", "to": "0.72", "kicker": "Births per woman · 2022", "kicker_to": "Births per woman · 2023", "hot": true, "source": "SOURCE: STATISTICS KOREA"}
  {"tool": "graphic", "cue": 12, "words": "...", "type": "yearbars", "country": "JPN", "indicator": "SP.DYN.CBRT.IN", "from": 1960, "title": "Births per 1,000 people · Japan", "hl": [{"from": 1971, "to": 1974, "label": "1971–1974", "sub": "the second baby boom"}, {"from": 2023, "to": 2023, "label": "2023", "sub": "the lowest yet", "hot": true}]}
  {"tool": "graphic", "cue": 10, "words": "...", "type": "hbars", "title": "Births per woman, 2024", "rows": [{"label": "World", "value": 2.19}, {"label": "United States", "value": 1.63}, {"label": "Japan", "value": 1.15}, {"label": "South Korea", "value": 0.75, "hot": true}], "ref": {"value": 2.1, "text": "2.1 replacement"}, "source": "SOURCE: WORLD BANK"}
  {"tool": "graphic", "cue": 15, "words": "...", "type": "ticker", "text": "$270,000,000,000", "kicker": "Spent on raising the birth rate · 2006–2023", "sub": "about 380 trillion won", "source": "SOURCE: NATIONAL ASSEMBLY BUDGET OFFICE"}
  {"tool": "graphic", "cue": 14, "words": "...", "type": "strike", "kicker": "The sampo generation", "items": ["dating", "marriage", "children"]}
  {"tool": "graphic", "cue": 20, "words": "...", "type": "quote", "text": "Give people money to have children? That will not work. Create a work system.", "mark": "Create a work system", "who": "Joan C. Williams", "role": "UC Law San Francisco", "subject": "Joan C. Williams", "query": "Joan C. Williams law professor"}
  {"tool": "graphic", "cue": 1, "words": "...", "type": "titlecard", "title": "The Empty Cradle", "sub": "South Korea, 1960–2026"}
  {"tool": "graphic", "cue": 5, "words": "...", "type": "docshot", "subject": "1983 Korean family planning poster", "query": "1983 family planning poster Korea two is too many", "note": {"text": "“Even two is too many.”", "sub": "Family-planning poster · 1983", "x": 0.25, "y": 0.6}, "source": "NATIONAL ARCHIVES OF KOREA"}
  {"tool": "graphic", "cue": 9, "words": "...", "type": "readline", "text": "Every hundred South Koreans would have thirty-six children.", "key": "thirty-six children"}
  {"tool": "graphic", "cue": 11, "words": "...", "type": "tab", "n": 2, "text": "Why it happened"}
  Useful World Bank indicators: SP.DYN.TFRT.IN births per woman · SP.POP.TOTL population · SP.DYN.LE00.IN life
  expectancy · NY.GDP.PCAP.CD GDP per person (US$) · SP.POP.65UP.TO.ZS share aged 65+ · SP.DYN.CBRT.IN births per 1,000
  · SP.URB.TOTL.IN.ZS urban share · SL.UEM.TOTL.ZS unemployment · FP.CPI.TOTL.ZG inflation. A year the World Bank has
  not published yet but the script states goes in "add": [[2025, 0.80]]. pyramid years run 1950-2100 (UN medium
  projection after 2023). linechart marks: 2-3 moments the narration names, the last "hot". gens takes the rate the
  script states. docshot = a real document, poster, letter or page the narration names (subject/query find it) with
  the translation or the key line in "note". quote = the exact words of a real person, never a paraphrase.
  numroll = one figure changing to another: "from" is the SAME figure's earlier real value (its kicker names the
  year) and "to" the later one; for a single figure give only "to" and it counts up — never a 0 or a start
  value the script does not state. Keep the figure as the script says it ("686,000", "2.5%").
  At most one linechart and one pyramid per two minutes; never the same type twice in a row.""",
    },
}

# DEEP-V2: DEEP's six scene types (the director asks for them the same way) in an old-machine skin — gold type that
# glows like a warm filament on black, incandescent indicator bulbs, amber phosphor screens, a pen plotter's drawing
KITS["deep2"] = dict(KITS["deep"], **{
    "label": "DEEP-V2",
    "fonts": [("Kit Bold", "Montserrat-ExtraBold.ttf", "800", "normal"), ("Kit Black", "Montserrat-Black.ttf", "900", "normal"),
              ("Kit Term", "VT323.ttf", "400", "normal"), ("Kit Cond", "BarlowCondensed-SemiBold.ttf", "600", "normal"),
              ("Kit Cond", "BarlowCondensed-Bold.ttf", "700", "normal"), ("Kit Mono", "SpaceMono-Bold.ttf", "700", "normal")],
    "palette": {"gold": "#EAB81A", "hot": "#FFD95A", "glow": "#E8701A", "ember": "#8A3F0C", "ink": "#F3E3B8",
                "black": "#050508", "panel": "#15100A", "red": "#FF4A2A"},
    "prompt": KITS["deep"]["prompt"].replace("- graphic — a DEEP graphic", "- graphic — a DEEP-V2 graphic")
    .replace("stencil = a stencilled date, place or name over the footage", "stencil = a date, place or name in glowing gold over black")
    .replace("cutaway = a cross-section silhouette", "cutaway = a vintage cross-section drawing")
    .replace("sonar = contacts on a sweeping screen", "sonar = contacts on an amber radar screen")
    .replace("readout = a classified file of 3-5 real facts", "readout = a lamp-lit console readout of 3-5 real facts "
             "(classification = the lit sign on top: TOP SECRET, WORLD RECORD, CLASSIFIED, FAILURE...)"),
})

CAPTIONED =("newsbar", "label", "moneyrain", "corner", "lower", "mosaic")     # scenes over sharp footage: captions may stay


def kit_of(look: dict) -> str:
    """The kit a style uses ("" when it is not a kit style)."""
    look = look or {}
    if str(look.get("graphics") or "").lower() != "kit":
        return ""
    k = str(look.get("kit") or "").lower().strip()
    return k if k in KITS else ""


def kit_for_style(engine, style: str) -> str:
    info = (getattr(engine, "STYLE_INFO", {}) or {}).get(style) or {}
    return kit_of(info.get("look") or {})


def durations(kit: str) -> dict:
    return dict(KITS.get(kit, {}).get("types") or {})


def prompt_block(kit: str) -> str:
    return KITS.get(kit, {}).get("prompt") or ""


def _min_s(kit: str, t: str) -> float:
    """The shortest a scene of this type may be cut to when the next one needs the room (2 s unless the kit says)."""
    return float((KITS.get(kit, {}).get("min_s") or {}).get(t, 2.0))


# ── the page ─────────────────────────────────────────────────────────────────────
_FONT_CACHE: dict = {}


def _font_css(kit: str) -> str:
    if kit not in _FONT_CACHE:
        css = []
        for fam, name, wt, st in KITS[kit]["fonts"]:
            # assets/kits/fonts/ holds faces that belong to a kit alone. A VARIABLE font
            # must live here and not in assets/fonts/, because that directory is handed
            # to libass for the subtitles: Inter-variable declares the family "Inter"
            # with a SemiBold instance, collides with Inter-SemiBold.ttf, and every
            # style whose captions ask for "Inter SemiBold" renders scrambled glyphs.
            f = FONTS / name
            if not f.exists():
                f = KIT_DIR / "fonts" / name
            if f.exists():
                css.append(f"@font-face{{font-family:'{fam}';font-style:{st};font-weight:{wt};"
                           f"src:url(data:font/ttf;base64,{base64.b64encode(f.read_bytes()).decode()});font-display:block}}")
        _FONT_CACHE[kit] = "".join(css)
    return _FONT_CACHE[kit]


PAGE = r"""<!doctype html><html><head><meta charset="utf-8"><style>
__FONTS__
html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#000}
*{box-sizing:border-box}
#stage{position:absolute;inset:0;overflow:hidden}
#ground{position:absolute;left:-60px;top:-34px;width:2040px;height:1148px;background-size:cover;background-position:center;transform-origin:50% 50%}
#scene{position:absolute;inset:0}
#grain{position:absolute;inset:0;pointer-events:none;opacity:0;mix-blend-mode:overlay;background-size:512px 512px}
#vig{position:absolute;inset:0;pointer-events:none}
.abs{position:absolute}
.mask{overflow:hidden;display:block;padding-bottom:.08em;margin-bottom:-.08em}
.line{display:block}
canvas.full{position:absolute;left:0;top:0;width:1920px;height:1080px}
</style></head><body><div id="stage"><div id="ground"></div><div id="scene"></div><div id="vig"></div><div id="grain"></div></div>
<script>
const S = __SCENE__;
const P = S.palette || {};
const W = 1920, H = 1080, D = S.duration || 6, OUT = Math.max(0.2, D - 0.45);
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const seg=(t,a,b)=>clamp((t-a)/Math.max(1e-4,b-a));
const lerp=(a,b,p)=>a+(b-a)*p;
const eo5=x=>1-Math.pow(1-x,5), eo3=x=>1-Math.pow(1-x,3), eio3=x=>x<.5?4*x*x*x:1-Math.pow(-2*x+2,3)/2, ei3=x=>x*x*x;
const eback=x=>{const c=1.6;return 1+(c+1)*Math.pow(x-1,3)+c*Math.pow(x-1,2)};
const ebounce=p=>{const n=7.5625,d=2.75;if(p<1/d)return n*p*p;if(p<2/d)return n*(p-=1.5/d)*p+.75;if(p<2.5/d)return n*(p-=2.25/d)*p+.9375;return n*(p-=2.625/d)*p+.984375};
let _s=(S.seed||7)>>>0; const rnd=()=>{_s=(_s*1664525+1013904223)%4294967296;return _s/4294967296};
const $=(h)=>{const d=document.createElement('div');d.innerHTML=h.trim();return d.firstChild};
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmt=(v,dec=0)=>{const p=Number(v).toFixed(dec).split('.');p[0]=p[0].replace(/\B(?=(\d{3})+(?!\d))/g,',');return p.join('.')};
const scene=document.getElementById('scene'), ground=document.getElementById('ground'), vig=document.getElementById('vig');
// typed text: the first n characters of a string, with a cursor
const typed=(s,n,cur='▍')=>esc(String(s).slice(0,Math.max(0,Math.floor(n))))+(n<String(s).length?`<span class="cur">${cur}</span>`:'');
// noise tile for grain (seeded)
(function(){const c=document.createElement('canvas');c.width=c.height=512;const x=c.getContext('2d');const im=x.createImageData(512,512);
 let s=1234567;for(let i=0;i<im.data.length;i+=4){s=(s*16807)%2147483647;const v=(s&255);im.data[i]=im.data[i+1]=im.data[i+2]=v;im.data[i+3]=255}
 x.putImageData(im,0,0);document.getElementById('grain').style.backgroundImage=`url(${c.toDataURL()})`})();
function grain(op){document.getElementById('grain').style.opacity=op}
function lines(el){   // wrap each rendered line of words in a mask, for a line-by-line rise
  const words=el.textContent.split(/\s+/).filter(Boolean); el.innerHTML=words.map(w=>`<span class="w">${esc(w)} </span>`).join('');
  const rows=[];let top=null;for(const sp of el.querySelectorAll('.w')){if(top===null||Math.abs(sp.offsetTop-top)>4){rows.push([]);top=sp.offsetTop}rows[rows.length-1].push(sp.textContent)}
  el.innerHTML=rows.map(r=>`<span class="mask"><span class="line">${esc(r.join('').trim())}</span></span>`).join('');
  return [...el.querySelectorAll('.line')];
}
function fit(el,maxW,big,small){ // shrink a one-line title until it fits: measured shrink-to-fit, not the box it sits in
  const w0=el.style.width, ws0=el.style.whiteSpace; el.style.width='auto'; el.style.whiteSpace='nowrap';
  let s=big; el.style.fontSize=s+'px'; while(s>small&&el.offsetWidth>maxW){s-=4;el.style.fontSize=s+'px'}
  const over=el.offsetWidth>maxW; el.style.width=w0; el.style.whiteSpace=over?'normal':ws0; if(over&&!w0)el.style.width=maxW+'px'; return s}
if(S.ground){ground.style.backgroundImage=`url(${S.ground})`}
let parts={};
__KITJS__
window.renderFrame=function(t){ frame(t); };
// every embedded face is loaded BEFORE build(): a face loads lazily on first use, so a title measured in build()
// (fit) would otherwise be measured in the fallback font and overflow once the real one arrives
Promise.all([...document.fonts].map(f=>f.load().catch(()=>null))).then(()=>document.fonts.ready).then(()=>{ try{ build(); window.renderFrame(0); }catch(e){ window.__err=String(e&&e.stack||e); } window.__ready=true; }).catch(e=>{ window.__err=String(e&&e.stack||e); window.__ready=true; });
window.addEventListener('error', e=>{ window.__err=window.__err||String(e.message||e); });
</script></body></html>"""


_PROP_URI: dict = {}


def _prop_uri(kit: str, name: str) -> str:
    """A kit's rendered prop (assets/kits/<kit>/<name>.png, drawn once by the image model) as a data URI, or ""."""
    key = f"{kit}/{name}"
    if key not in _PROP_URI:
        f = KIT_DIR / kit / f"{name}.png"
        _PROP_URI[key] = ("data:image/png;base64," + base64.b64encode(f.read_bytes()).decode()) if f.exists() else ""
    return _PROP_URI[key]


def _ground_uri(name: str) -> str:
    """A generated ground (assets/kits/frames/gen_<name>.jpg) as a data URI, or ""."""
    key = f"frames/{name}"
    if key not in _PROP_URI:
        f = KIT_DIR / "frames" / f"gen_{name}.jpg"
        _PROP_URI[key] = ("data:image/jpeg;base64," + base64.b64encode(f.read_bytes()).decode()) if f.exists() else ""
    return _PROP_URI[key]


def _with_props(kit: str, sc: dict) -> dict:
    """The scene with the props its type uses attached (HUSTLE: the 3D icon, the bill; KINETIC: the chalkboard;
    ATLAS: the sunburst wall behind the title)."""
    if kit == "kinetic" and sc.get("type") in ("board", "doodle"):
        sc["board"] = _ground_uri("sketchboard")
    if kit == "atlas" and sc.get("type") == "stamp":
        sc["wall"] = _ground_uri("titlewall")
    if kit == "hustle":
        if sc.get("type") == "icon3d":
            sc["prop"] = _prop_uri(kit, str(sc.get("icon") or "search").lower())
        if sc.get("type") == "moneyrain":
            sc["bill"] = _prop_uri(kit, "bill")
        if sc.get("type") == "counter":
            sc["stack"] = _prop_uri(kit, "stack")
    if kit == "pulse" and sc.get("type") == "phone" and sc.get("company") and not sc.get("logo"):
        try:
            import logos
            sc["logo"] = logos.data_uri(str(sc["company"]), on="dark")
        except Exception:                                   # noqa: BLE001
            pass
    if kit == "pulse" and sc.get("type") == "ticker":
        try:
            import logos
            for it in sc.get("items") or []:
                if isinstance(it, dict) and it.get("company") and not it.get("logo"):
                    it["logo"] = logos.data_uri(str(it["company"]), on="dark")
        except Exception:                                   # noqa: BLE001
            pass
    if kit == "pulse" and sc.get("type") == "picker" and sc.get("company") and not sc.get("logo"):
        try:
            import logos
            sc["logo"] = logos.data_uri(str(sc["company"]), on="dark")
        except Exception:                                   # noqa: BLE001
            pass
    if kit == "pulse" and sc.get("type") == "flip" and sc.get("company") and not sc.get("logo"):
        try:
            import logos
            sc["logo"] = logos.data_uri(str(sc["company"]), on="dark")
        except Exception:                                   # noqa: BLE001
            pass
    if kit == "pulse" and sc.get("type") == "leaderboard":
        try:
            import logos
            for r in sc.get("rows") or []:
                if isinstance(r, dict) and r.get("company") and not r.get("logo"):
                    r["logo"] = logos.data_uri(str(r["company"]), on="dark")
        except Exception:                                   # noqa: BLE001
            pass
    if kit == "pulse" and sc.get("type") == "breach" and not sc.get("logo") and sc.get("company"):
        try:
            import logos
            sc["logo"] = logos.data_uri(str(sc["company"]), on="dark")
        except Exception:                                   # noqa: BLE001
            pass
    if kit == "pulse" and sc.get("type") == "breakout" and not sc.get("logo") and sc.get("company"):
        try:
            import logos
            sc["logo"] = logos.data_uri(str(sc["company"]), on="dark")
        except Exception:                                   # noqa: BLE001
            pass
    if kit == "pulse" and sc.get("type") == "hand":
        try:
            import logos
            for c in sc.get("cards") or []:
                if isinstance(c, dict) and not c.get("logo"):
                    c["logo"] = logos.data_uri(str(c.get("company") or c.get("tag") or ""), on="dark")
        except Exception:                                   # noqa: BLE001 - a card without a mark shows its name
            pass
    if kit == "pulse" and sc.get("type") in ("logo", "snap"):
        # the company's real mark, looked up once and cached from then on; "" when the
        # company has none, and the scene then sets its name as type instead
        try:
            import logos
            sc["logo"] = logos.data_uri(str(sc.get("name") or ""), on="dark")
        except Exception:                                   # noqa: BLE001 - a logo never fails a render
            sc["logo"] = ""
    if kit == "almanac":
        # the ALMANAC page cannot open a file: footage clips become frame lists, and every picture — inside lists
        # too (the film's frames, the hand's cards) — a data URI with its cut-out metadata (almanac_prep.py). Film
        # that cannot be prepared is left out: the scene keeps its cards and its type and plays without it.
        import almanac_prep
        try:
            sc = almanac_prep.prep_scene(sc, base=HERE, inline=True)
        except Exception as e:                              # noqa: BLE001 - film never fails a render
            # the film and the pictures are prepared apart, so a picture that fails its measuring does not
            # take a good film down with it (nor the other way round)
            fo = sc.pop("footage", None)
            try:
                sc = almanac_prep.prep_scene(sc, base=HERE, inline=True)
            except Exception:                               # noqa: BLE001
                sc = almanac_prep.inline_images(sc, HERE)
            if fo is not None:
                try:
                    sc["footage"] = almanac_prep.prep_scene({"type": sc.get("type"), "footage": fo},
                                                            base=HERE, inline=True)["footage"]
                except Exception:                           # noqa: BLE001
                    print(f"  kits: almanac/{sc.get('type')} plays without its film — {str(e)[:120]}")
        fo = sc.get("footage")
        if sc.get("type") == "reel" and not (fo if isinstance(fo, list) else isinstance(fo, dict) and fo.get("frames")):
            sc["open"] = False                              # no film to dive into: the reel holds on its card
        # the reel sizes its exposure smear from the shutter it is rendered at (render() reads the same key)
        sc.setdefault("shutter", SHUTTER)
    if kit == "strata":
        # a specimen's cut-out, the team's portraits, a paper's page arrive as file paths: the page cannot open files
        import almanac_prep
        sc = almanac_prep.inline_images(sc, HERE)
    if kit == "horizon":
        # the series and pyramids a scene names are fetched (World Bank, UN WPP — cached in ~/.frontier/horizon) and
        # its picture inlined with its size; a scene that cannot be drawn truthfully carries an error and throws
        import horizon
        sc = horizon.prep(sc)
    return sc


def build_html(kit: str, scene: dict, look: dict = None) -> str:
    js = (KIT_DIR / f"{kit}.js").read_text(encoding="utf-8")
    sc = _with_props(kit, dict(scene))
    sc.setdefault("palette", dict(KITS[kit]["palette"]))
    acc = (look or {}).get("accent") or []
    if acc:
        sc["palette"].setdefault("accent", acc[0])
    sc.setdefault("seed", 7)
    return (PAGE.replace("__FONTS__", _font_css(kit)).replace("__KITJS__", js)
            .replace("__SCENE__", json.dumps(sc, ensure_ascii=False)))


def render(kit: str, jobs: list, workers: int = 2, look: dict = None, fps: int = FPS) -> list:
    """jobs = [(scene, out_mp4)] — Chromium, one screenshot per frame (docgfx.render's loop)."""
    import motion
    from playwright.sync_api import sync_playwright
    tmp = Path(tempfile.mkdtemp(prefix="kit_"))
    prepared = [(build_html(kit, sc, look), float(sc.get("duration", 6.0)), Path(out), tmp / f"f{i:03d}", sc)
                for i, (sc, out) in enumerate(jobs)]
    workers = max(1, min(workers, len(prepared)))

    def one(chunk):
        last = None
        for attempt in range(3):
            pw = None
            try:
                with motion._PW_START:
                    pw = sync_playwright().start()
                browser = pw.chromium.launch(args=["--force-color-profile=srgb", "--disable-gpu", "--font-render-hinting=none"])
                for html, dur, out, fdir, sc in chunk:
                    if out.exists() and out.stat().st_size > 10_000:
                        continue
                    fdir.mkdir(parents=True, exist_ok=True)
                    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
                    page.set_content(html, wait_until="load")
                    page.wait_for_function("window.__ready===true", timeout=60000)
                    err = page.evaluate("window.__err||''")
                    if err:
                        raise RuntimeError(f"{kit}/{sc.get('type')}: {err[:300]}")
                    step = 1 if fps >= FPS else 2
                    n = max(1, int(round(dur * FPS)))
                    k_out = 0
                    shutter = int(sc.get("shutter", SHUTTER) or 1)
                    for k in range(0, n, step):
                        if shutter <= 1:
                            page.evaluate("(t)=>window.renderFrame(t)", k / FPS)
                            page.screenshot(path=str(fdir / f"f_{k_out:05d}.jpg"), type="jpeg", quality=94,
                                            clip={"x": 0, "y": 0, "width": W, "height": H})
                        else:
                            acc = None
                            for j in range(shutter):
                                page.evaluate("(t)=>window.renderFrame(t)", k / FPS + j * 0.5 / FPS / shutter)
                                raw = page.screenshot(type="jpeg", quality=94, clip={"x": 0, "y": 0, "width": W, "height": H})
                                arr = _np.asarray(_Image.open(_io.BytesIO(raw)).convert("RGB"), dtype=_np.float32)
                                acc = arr if acc is None else acc + arr
                            _Image.fromarray((acc / shutter + 0.5).astype(_np.uint8)).save(fdir / f"f_{k_out:05d}.jpg", quality=94)
                        k_out += 1
                    _frames_to_mp4(fdir, out, FPS // step)
                    shutil.rmtree(fdir, ignore_errors=True)
                    page.close()
                browser.close()
                return
            except Exception as e:                              # noqa: BLE001 - driver flakiness
                last = e
                if "__err" in str(e) or ": " in str(e) and str(e).startswith(kit):
                    raise
                time.sleep(3.0 * (attempt + 1))
            finally:
                if pw is not None:
                    try:
                        pw.stop()
                    except Exception:                           # noqa: BLE001
                        pass
        raise RuntimeError(f"kits: rendering failed: {last}")

    try:
        with ThreadPoolExecutor(max_workers=workers) as ex:
            list(ex.map(one, [prepared[i::workers] for i in range(workers)]))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return [Path(o) for _, o in jobs]


def _frames_to_mp4(frames_dir: Path, out_mp4: Path, fps: int) -> None:
    import subprocess
    # a stepped scene (15 fps) is written at the timeline's 30 fps by repeating frames, so its length is exact
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-framerate", str(fps), "-i", str(frames_dir / "f_%05d.jpg"),
                    "-c:v", "libx264", "-preset", "veryfast", "-crf", "19", "-pix_fmt", "yuv420p", "-color_range", "tv",
                    "-r", str(FPS), str(out_mp4)], check=True, capture_output=True)


# ── sound ────────────────────────────────────────────────────────────────────────
# A kit's own recorded sounds, used in place of the shared synthesised bank when they are installed:
# assets/<folder>/<cue>_<n>.wav (whoosh_1.wav, whoosh_out_1.wav, typekey_3.wav …). PULSE's are Epidemic Sound
# effects under Robin's licence (epidemic.py fetched them; .shipignore keeps assets/sfx/es/ on this machine),
# so a buyer's copy simply falls back to the synthesised sounds.
SOUND_PACKS = {"pulse": "sfx/es/pulse", "strata": "sfx/es/strata"}


def _pack_files(kit: str) -> dict:
    """{cue: [(file mark, gain dB)]}. The gain is the pack's index.json "gain_db": a recording is
    peak-normalised when it is loaded, so a click with a 25 dB crest would sound far quieter than the
    synthesised click the marks were tuned on — each take carries what brings it level with that."""
    rel = SOUND_PACKS.get(kit)
    d = HERE / "assets" / rel if rel else None
    if d is None or not d.is_dir():
        return {}
    try:
        gains = {r["file"]: float(r.get("gain_db") or 0) for r in json.loads((d / "index.json").read_text(encoding="utf-8"))}
    except (OSError, ValueError, KeyError, TypeError):
        gains = {}
    out = {}
    for f in sorted(d.glob("*.wav")):
        head, _, tail = f.stem.rpartition("_")
        out.setdefault(head if tail.isdigit() else f.stem, []).append((f"file:{rel}/{f.name}", gains.get(f.name, 0.0)))
    return out


def sound_marks(kit: str, sc: dict) -> list:
    """[(second, sound, dB)] under this scene — the kit's own recordings where it ships them (SOUND_PACKS),
    else sfx.py BANK names. Variants turn over mark by mark, so a run of keys or taps never repeats one take."""
    marks = _sound_marks(kit, sc)
    pack = _pack_files(kit)
    if not pack:
        return marks
    out = []
    for i, (at, name, db) in enumerate(marks):
        if name in pack:
            f, g = pack[name][i % len(pack[name])]
            out.append((at, f, round(db + g, 1)))
        else:
            out.append((at, name, db))
    return out


def _sound_marks(kit: str, sc: dict) -> list:
    t, d = sc.get("type"), float(sc.get("duration", 6.0))
    k = kit
    if k == "strata":
        import strata
        return strata.sound_marks(sc)
    if k == "horizon":
        import horizon
        return horizon.sound_marks(sc)
    if k == "dossier":
        if t in ("alert", "dialogue", "stamp"):
            n = int(min(28, max(6, d * 5)))
            return [(0.0, "static", -14.0)] + [(0.25 + i * (min(3.2, d - 1.5) / n), "typekey", -13.0) for i in range(n)] + [(d - 0.6, "hit", -12.0)]
        if t == "crosshair":
            return [(0.0, "whoosh", -6.0), (1.1, "click", -6.0), (1.6, "ping", -12.0)]
        if t == "disclaimer":
            return [(0.0, "static", -9.0), (0.3, "hit", -8.0)]
        if t == "title_gold":
            return [(0.0, "riser", -8.0), (1.2, "hit", -3.0)]
        if t == "tracker":
            return [(0.0, "static", -12.0), (0.9, "click", -6.0), (1.8, "typekey", -12.0), (2.4, "click", -8.0)]
        if t == "stack":
            return [(0.0, "paper", -4.0), (1.3, "paper", -5.0), (2.6, "paper", -5.0), (3.4, "click", -9.0)]
    if k == "kinetic":
        if t == "bigword":
            return [(0.05, "hit", -5.0), (1.5, "hit", -6.0)]
        if t == "board":
            return [(0.0, "whoosh", -6.0), (0.4, "tap", -12.0)] + [(1.2 + i * 0.07, "typekey", -18.0) for i in range(18)]
        if t == "doodle":
            return [(0.1, "tap", -10.0), (0.5, "tap", -12.0), (0.9, "tap", -12.0), (1.3, "pop", -9.0)]
        if t == "phones":
            return [(0.2, "whoosh", -5.0), (1.2, "whoosh", -6.0), (2.2, "whoosh", -6.0), (3.4, "whoosh_out", -8.0)] + \
                   [(3.9 + i * 0.08, "typekey", -16.0) for i in range(16)]
        if t == "comment":
            return [(0.0, "whoosh", -7.0), (1.4, "click", -8.0), (2.4, "click", -8.0), (3.4, "click", -8.0)]
        if t == "scroll":
            return [(0.0, "whoosh", -6.0), (2.5, "whoosh", -9.0)]
        if t == "mosaic":
            return [(0.3, "pop", -6.0), (0.9, "pop", -6.0)]
        if t == "sources":
            return [(0.4 + i * 0.09, "typekey", -15.0) for i in range(24)]
    if k == "atlas":
        if t == "timemachine":
            return [(0.1, "pop", -13.0), (3.2, "boing", -16.0)]
        if t == "flipchart":
            n = max(1, len(sc.get("pages") or []) - 1)
            return [(0.9 + i * max(1.2, (d - 1.4) / n), "paper", -13.0) for i in range(n)]
        if t == "watch":
            return [(0.3, "click", -15.0), (1.4, "boing", -17.0)]
        if t == "stamp":
            return [(0.15 + i * 0.12, "pop", -10.0) for i in range(6)] + [(1.6, "boing", -10.0)]
        if t == "wave":
            return [(0.0, "whoosh", -7.0)]
        if t == "scoreboard":
            return [(0.2, "pop", -10.0), (0.5, "pop", -10.0), (1.0, "riser", -14.0), (3.0, "boing", -12.0)]
        if t == "signpost":
            return [(0.2, "boing", -10.0), (0.9, "pop", -11.0), (1.3, "pop", -11.0), (1.7, "pop", -11.0)]
    if k in ("deep", "deep2"):
        if t == "stencil":
            return [(0.0, "ping", -8.0), (0.3, "hit", -9.0)]
        if t == "route":
            return [(0.0, "ping", -8.0), (1.2, "whoosh", -9.0), (3.5, "ping", -11.0)]
        if t == "cutaway":
            return [(0.0, "hum", -9.0), (1.4, "ping", -10.0), (2.8, "ping", -12.0)]
        if t == "sonar":
            return [(0.0, "ping", -6.0), (1.7, "ping", -6.0), (3.4, "ping", -6.0)]
        if t == "readout":
            return [(0.0, "static", -14.0)] + [(0.5 + i * 0.09, "typekey", -16.0) for i in range(22)]
        if t == "maproom":
            return [(0.0, "hum", -10.0), (2.2, "click", -9.0), (3.0, "whoosh", -9.0)]
    if k == "frontline":
        if t == "newsbar":
            return [(0.1, "whoosh", -12.0)]
        if t == "timeline":
            return [(0.6 + i * 0.5, "tap", -11.0) for i in range(min(5, len(sc.get("events") or [])))]
        if t == "label":
            return [(0.0, "click", -6.0), (0.2, "pop", -9.0)]
        if t == "arrows":
            return [(0.9, "whoosh", -11.0), (1.9, "whoosh", -12.0)]
        if t == "ticker":
            return [(0.0, "sting", -11.0)]
        if t == "count":
            return [(0.3, "riser", -13.0)]
    if k == "legend":
        if t == "chapter":
            return [(0.0, "whoosh", -6.0), (0.7, "hit", -9.0)]
        if t == "lower":
            return [(0.0, "whoosh", -9.0)]
        if t == "scorecard":
            return [(0.0, "paper", -5.0), (1.0, "tap", -8.0), (1.5, "tap", -8.0), (2.0, "tap", -8.0)]
        if t == "line":
            return [(0.0, "whoosh", -8.0)]
        if t == "years":
            return [(0.3 + i * 0.6, "tap", -8.0) for i in range(5)]
    if k == "hustle":
        if t == "bar":
            n = int(sc.get("value") or 6)
            return [(0.0, "whoosh", -6.0)] + [(0.9 + i * 0.12, "click", -9.0) for i in range(max(1, min(14, n)))]
        if t == "icon3d":
            return [(0.1, "whoosh", -5.0), (0.6, "pop", -5.0), (1.2, "pop", -7.0)]
        if t == "moneyrain":
            return [(0.0, "cash", -6.0), (1.2, "cash", -8.0)]
        if t == "corner":
            return [(0.1, "pop", -6.0), (0.5, "pop", -6.0)]
        if t == "counter":
            return [(0.2, "riser", -9.0), (2.2, "cash", -5.0)]
        if t == "versus":
            return [(0.2, "hit", -6.0), (1.0, "pop", -7.0), (1.4, "pop", -7.0), (1.8, "pop", -7.0)]
        if t == "checklist":
            return [(0.8 + i * 0.7, "pop", -6.0) for i in range(5)]
    if k == "tape":
        if t == "title":
            return [(0.3, "whoosh", -10.0), (1.2, "hit", -10.0)]
        if t == "player":
            return [(0.0, "whoosh", -8.0), (0.7, "click", -10.0)]
        if t == "subs":
            return [(0.2, "riser", -10.0), (2.5, "pop", -6.0)]
        if t == "post":
            return [(0.1, "pop", -6.0), (1.5, "click", -9.0), (2.6, "click", -9.0)]
        if t == "timeline":
            return [(0.2, "whoosh", -8.0)] + [(0.7 + i * 0.55, "tap", -7.0) for i in range(5)]
        if t == "quote":
            return [(0.0, "whoosh", -9.0), (0.4, "tap", -9.0)]
        if t == "versus":
            return [(0.1, "whoosh", -7.0), (0.3, "whoosh", -7.0), (0.9, "hit", -8.0)]
        if t == "chapter":
            return [(0.05, "hit", -7.0), (0.4, "whoosh", -9.0)]
    if k == "analog":
        if t == "machine":
            return [(0.05, "whoosh", -7.0), (0.35, "hit", -11.0)] + \
                   [(1.6 + i * 0.42, "typekey", -15.0) for i in range(min(5, len(sc.get("specs") or [])))]
        if t == "steps":
            return [(0.0, "whoosh", -11.0)] + _pattern_marks(sc)
        if t == "wave":
            lanes = (sc.get("lanes") or [{"sound": sc.get("sound") or "kick"}])[:2]
            return [(0.45 + j * 1.7, _DRUM.get(str(l.get("sound") or "kick").lower()[:4], ("bd808", 6.0))[0],
                     _DRUM.get(str(l.get("sound") or "kick").lower()[:4], ("bd808", 6.0))[1]) for j, l in enumerate(lanes)]
        if t == "record":
            return [(0.05, "whoosh", -8.0), (0.8, "whoosh", -13.0), (1.5, "crackle", -4.0)]
        if t == "price":
            n = len(sc.get("tags") or []) or 1
            gap = min(1.3, (d - 2.2) / max(1, n))
            out = [(0.2 + i * gap + 0.35, "paper", -6.0) for i in range(n)] + [(0.2 + i * gap + 0.95, "tap", -9.0) for i in range(n - 1)]
            if sc.get("stamp"):
                out.append((0.2 + (n - 1) * gap + 1.2, "hit", -6.0))
            return out
        if t == "units":
            a = min(d - 1.4, 3.6)
            return [(0.2, "riser", -12.0)] + [(0.5 + i * 0.22, "click", -14.0) for i in range(int((a - 0.6) / 0.22))] + \
                   ([(a + 0.05, "hit", -4.0)] if sc.get("stamp") else [])
        if t == "timeline":
            return [(0.1, "whoosh", -9.0)] + [(0.4 + i * 0.5, "paper", -9.0) for i in range(min(5, len(sc.get("events") or [])))]
        if t == "quote":
            return [(0.05, "whoosh", -9.0), (0.35, "paper", -6.0)]
        if t == "city":
            return [(0.0, "whoosh", -6.0), (0.35, "hit", -8.0)]
    if k == "almanac":
        # on the scenes' own beats (almanac.js): quiet paper and print sounds, one firm hit where something lands
        if t == "bar":                                  # the shutter drops, the bar grows, the name rises
            return [(0.0, "whoosh", -12.0), (0.42, "whoosh", -17.0), (0.62, "tap", -15.0)]
        if t == "card":                                 # the card pops, the object lands on the title
            return [(0.02, "paper", -8.0), (0.42, "whoosh", -13.0), (0.66, "tap", -12.0)]
        if t == "reel":
            # the strip slides in at 0.19 s, the riser lands on the spin's peak, a soft settle where the strip coasts
            # down under 1 px/frame onto the gate (no lock, so no click), then the dive — on reel.js's own clock
            c = _reel_clock(sc, d)
            out = [(0.22, "whoosh", -12.0), (round(c["tp"], 2), "riser", -17.0), (round(c["rest"], 2), "paper", -18.0)]
            if c["dive"]:
                out.append((round(c["tz"], 2), "whoosh", -8.0))
            return out
        if t == "hand":                                 # the deck lands, the cards print, one is pulled
            n = min(5, len(sc.get("cards") or []))
            out = [(0.05, "paper", -8.0)] + [(round(0.62 + 0.09 * i, 2), "paper", -16.0) for i in range(n)]
            if _hand_hero(sc.get("hero"), n) >= 0:
                try:
                    want = float(sc["pull_at"]) if sc.get("pull_at") not in (None, "") else min(max(d - 4.15, 2.3), 2.85)
                except (TypeError, ValueError):
                    want = 2.5
                heading = 0.34 + max(0, len(str(sc.get("title") or "")) - 1) / 25 + 1.65
                out.append((round(max(want, 1.86 + 0.09 * max(0, n - 1), heading), 2), "whoosh", -9.0))
            return out
        if t == "tally":
            return [(0.2, "riser", -16.0)]
        if t == "cardwall":                             # the crack, the flip wave, the frame clamps on
            try:
                s = float(sc["split_at"]) if sc.get("split_at") is not None else 0.25
            except (TypeError, ValueError):
                s = 0.25
            dl = s - 0.25
            return [(s, "hit", -12.0), (1.15 + dl, "paper", -14.0), (1.55 + dl, "paper", -15.0), (2.25 + dl, "click", -8.0)]
        if t == "register":                             # the plates fly in and snap, the proof stamp slams
            out = [(0.3, "whoosh", -14.0), (1.0, "tap", -12.0), (1.2, "tap", -12.0)]
            if sc.get("stamp"):
                kap = min(max((d - 1.6) / 5.4, 0.45), 1.0)
                try:
                    at = float(sc["stamp_at"]) if sc.get("stamp_at") is not None else max(4.55 * kap + 0.25, d - 1.5)
                except (TypeError, ValueError):
                    at = d - 1.5
                out.append((round(at + 0.09, 2), "hit", -6.0))
            return out
    if k == "pulse":
        # Every time below is read off pulse.js — the same seg() windows the frame() of
        # each scene animates on — so a sound lands on the frame the thing happens in.
        # One scene, one loud moment; everything else sits under the voice.
        def keys(t0, n, per, db=-19.0, every=1):
            return [(round(t0 + i * per, 3), "typekey", db) for i in range(0, max(0, n), max(1, every))]
        if t == "snap":                                 # the shutter IS the scene: loudest sound in the kit
            hit = min(0.30, 1.5 / d) * d
            n = len(str(sc.get("line") or ""))
            per = min(0.028, max(0.012, (d * 0.30) / max(1, n)))
            return ([(round(hit, 3), "shutter", 2.0), (round(hit + 0.02, 3), "whoosh", -10.0),
                     (round(hit + 0.5, 3), "hit", -10.0)] + keys(hit + 0.62, n, per, -21.0, every=3))
        if t == "multiplier":                           # the dial runs d*.28 -> d*.74 (or to land_at) and slows as it lands
            b = min(max(float(sc["land_at"]), 0.9), d - 0.3) if sc.get("land_at") is not None else d * 0.74
            a = min(d * 0.28, b - 0.7)
            ticks = [a + (b - a) * (1 - (1 - i / 11) ** 2) for i in range(12)]   # eased like the count
            return ([(0.0, "whoosh", -6.0)] + [(round(x, 3), "tap", -15.0) for x in ticks]
                    + [(round(b, 3), "hit", -5.0)])
        if t == "board":                                # typed at 8-30 %, the turn chip drops at 59 %,
            n1 = len(str(sc.get("line") or ""))        # the answer types from 64 %
            n2 = len(str(sc.get("line2") or ""))
            out = [(0.0, "whoosh", -12.0)] + keys(d * 0.08, n1, (d * 0.22) / max(1, n1), -19.0, every=2)
            if sc.get("line2"):
                out += [(round(d * 0.59, 3), "pop", -8.0)] + keys(d * 0.64, n2, (d * 0.18) / max(1, n2), -19.0, every=2)
            return out
        if t == "bench":                                # each bar starts .7+i*.16; the subject lights after it grows
            rows = sc.get("rows") or []
            hot = next((i for i, r in enumerate(rows) if r.get("hot")), None)
            out = [(0.1, "whoosh", -7.0)] + [(round(0.7 + i * 0.16, 3), "tap", -14.0) for i in range(len(rows))]
            if hot is not None:
                out.append((round(2.0 + hot * 0.16, 3), "ping", -9.0))
            return out
        if t == "spec":                                 # the cells land .5+i*.22 and count up
            items = sc.get("items") or []
            hot = next((i for i, r in enumerate(items) if r.get("hot")), len(items) - 1)
            return ([(0.05, "whoosh", -8.0)] + [(round(0.5 + i * 0.22, 3), "click", -12.0) for i in range(len(items))]
                    + [(round(1.9 + hot * 0.22, 3), "ping", -11.0)])
        if t == "versus":                               # rows .8+i*.28, the winner's cell lights .5 s later
            rows = sc.get("rows") or []
            return ([(0.1, "whoosh", -7.0)] + [(round(0.8 + i * 0.28, 3), "click", -12.0) for i in range(len(rows))]
                    + [(round(1.3 + i * 0.28, 3), "tap", -15.0) for i, r in enumerate(rows) if r.get("win")])
        if t == "logo":                                 # assembles .15-1.05, then the line
            return [(0.1, "whoosh", -6.0), (1.0, "hit", -5.0)]
        if t == "typecard":
            n = len(str(sc.get("text") or ""))
            end = max(0.9, n / 21 + 0.35)
            return [(0.0, "whoosh", -10.0)] + keys(0.15, n, (end - 0.15) / max(1, n), -17.0) + [(round(end, 3), "hit", -9.0)]
        if t == "namecard":                             # the name rows snap up one after another
            n = len(str(sc.get("name") or "").split())
            return [(0.0, "whoosh", -7.0)] + [(round(0.72 + i * 0.13, 3), "hit", -9.0 - 3 * i) for i in range(n)]
        if t == "post":                                 # the post lands, each marked phrase is struck
            m = len(sc.get("marks") or [])
            return [(0.0, "pop", -8.0)] + [(round(1.1 + i * 0.95, 3), "tap", -12.0) for i in range(m)]
        if t == "annot":                                # the sentence builds, the phrase is boxed, the label hangs
            n = len(str(sc.get("line") or "").split())
            return keys(0.25, n, 0.085, -17.0) + [(1.5, "tap", -10.0), (1.95, "pop", -11.0)]
        if t == "grid":                                 # tiles fly in and lock, the title types, the spare tile leaves
            return [(0.1, "whoosh", -6.0), (1.25, "hit", -8.0)] + keys(1.5, 12, 0.055, -19.0) + [(2.3, "whoosh", -11.0)]
        if t == "hud":                                  # the identity panel types itself beside the subject
            n = len(str(sc.get("who") or "")) + len(str(sc.get("role") or ""))
            return [(0.0, "static", -16.0), (0.7, "click", -10.0)] + keys(0.5, n, 0.011 * 3, -20.0, every=3) + [(1.9, "ping", -13.0)]
        if t == "eval":                                 # the cells land one after another, then the score turns orange
            n = max(1, min(100, int(sc.get("total") or 50)))
            end = max(1.4, d - 1.2)
            per = (end - 0.4) / n
            return ([(0.1, "whoosh", -12.0)] + [(round(0.4 + i * per, 3), "tap", -21.0) for i in range(0, n, 2)]
                    + [(round(end + 0.05, 3), "hit", -6.0), (round(end + 0.2, 3), "ping", -12.0)])
        if t == "phone":                                # the phone rises, the message is sent, the reply streams
            return [(0.05, "whoosh", -7.0), (0.75, "tap", -12.0), (0.95, "pop", -10.0)] + keys(1.6, 14, 0.22, -21.0)
        if t == "ticker":                               # runs past fast, eases to a stop on the focus
            stop = max(1.2, d * 0.62)
            return [(0.0, "whoosh", -6.0), (round(stop * 0.55, 3), "whoosh", -13.0), (round(stop, 3), "hit", -7.0)]
        if t == "stats":                                # the tiles land .2 + i*.32 (or on item.at) and count up
            items = (sc.get("items") or [])[:4]
            lands = [float(it["at"]) if isinstance(it, dict) and it.get("at") is not None else 0.2 + i * 0.32
                     for i, it in enumerate(items)]
            return ([(0.1, "whoosh", -11.0)] + [(round(x, 3), "pop", -11.0) for x in lands]
                    + [(round(max(lands) + 1.1, 3), "hit", -7.0)] if lands else [])
        if t == "picker":                               # the menu opens, the cursor travels, clicks, the check lands
            n = min(6, len(sc.get("models") or []))
            return ([(0.05, "whoosh", -11.0), (0.8, "pop", -12.0)] + [(round(0.95 + i * 0.07, 3), "tap", -18.0) for i in range(n)]
                    + [(2.4, "click", -5.0), (2.58, "ping", -11.0), (3.3, "tap", -14.0)])
        if t == "context":                              # pages fly in and stack while the counter runs
            end = max(1.4, d - 1.4)
            return ([(0.05, "whoosh", -10.0), (0.4, "riser", -16.0)]
                    + [(round(0.4 + (end - 0.4) * (i / 25) - 0.05, 3), "paper", -19.0) for i in range(0, 26, 3)]
                    + [(round(end, 3), "hit", -6.0), (round(end + 0.15, 3), "ping", -13.0)])
        if t == "quote":                                # the words build; the phrase that matters turns pink
            n = len(str(sc.get("text") or "").split())
            per = min(0.12, (d * 0.55) / max(1, n))
            words = [w.lower().strip(",.;:!?") for w in str(sc.get("text") or "").split()]
            mk = str(sc.get("mark") or "").lower().split()
            at = next((i for i in range(len(words)) if mk and words[i:i + len(mk)] == [m.strip(",.;:!?") for m in mk]), None)
            out = [(0.1, "whoosh", -11.0)] + [(round(0.35 + i * per, 3), "tap", -21.0) for i in range(0, n, 2)]
            if at is not None:
                out.append((round(0.35 + at * per + 0.2, 3), "pop", -10.0))
            return out
        if t == "flip":                                 # the flaps fall at .35 / .47 and land .22 later; the name rises
            return [(0.35, "click", -6.0), (0.47, "click", -8.0), (0.60, "tap", -10.0), (0.72, "tap", -12.0),
                    (0.95, "whoosh", -9.0), (1.2, "hit", -9.0)]
        if t == "leaderboard":                          # rows enter, the subject climbs 1.1-2.6 and lights
            n = min(7, len(sc.get("rows") or []))
            return ([(0.1, "whoosh", -9.0)] + [(round(0.1 + i * 0.06 + 0.2, 3), "tap", -17.0) for i in range(n)]
                    + [(1.1, "riser", -14.0), (1.12, "whoosh", -9.0), (2.6, "hit", -5.0), (2.8, "ping", -12.0)])
        if t == "timeline":                             # each date pops as the camera reaches it; the last one lands
            n = min(7, len(sc.get("events") or []))
            end = max(1.2, d - 1.6)
            reach = [0.3 + (end - 0.3) * (i / (n - 1)) - 0.25 if n > 1 else 0.3 for i in range(n)]
            return ([(0.3, "whoosh", -10.0)] + [(round(r + 0.1, 3), "pop", -12.0) for r in reach[:-1]]
                    + ([(round(reach[-1] + 0.1, 3), "hit", -5.0), (round(end + 0.05, 3), "ping", -11.0)] if reach else []))
        if t == "pricecut":                             # stands, is struck at .8, drifts off; the new one lands at 2.05
            return [(0.0, "whoosh", -10.0), (0.8, "whoosh", -13.0), (1.0, "tap", -9.0), (1.45, "whoosh", -8.0),
                    (2.05, "hit", -4.0)] + [(round(2.0 + i * 0.1, 3), "tap", -17.0) for i in range(6)] + [(2.62, "ping", -12.0)]
        if t == "breach":                               # each refused request knocks on the gate; the way round opens the files
            k = d / 11.2
            n = max(1, min(4, int(sc.get("tries") or 3)))
            out = [(0.05, "whoosh", -12.0)]
            for i in range(n):
                t0 = (1.2 + i * 1.05) * k
                out += [(round(t0, 3), "tap", -16.0), (round(t0 + 0.45 * k, 3), "hit", -9.0 - i)]
            w0 = 4.6 * k
            sa = float(sc["safe_at"]) if sc.get("safe_at") is not None else 8.6 * k
            return out + [(round(w0, 3), "riser", -14.0), (round(w0 + 2.0 * k, 3), "hit", -5.0), (round(sa, 3), "ping", -13.0)]
        if t == "breakout":                             # the line runs out through the gap, then reaches each system
            n = min(4, len(sc.get("outer") or []))
            return ([(0.0, "whoosh", -12.0), (0.9, "riser", -15.0), (1.4, "tap", -11.0), (1.95, "ping", -12.0)]
                    + [(round(2.15 + i * 0.28 + 0.62, 3), "hit", -9.0) for i in range(n)])
        if t == "chat":                                 # the window rises, the prompt types, it is sent, the answer streams
            n = len(str(sc.get("prompt") or ""))
            type_end = min(2.1, 0.6 + n * 0.028)
            return ([(0.05, "whoosh", -9.0)] + keys(0.6, n, (type_end - 0.6) / max(1, n), -19.0, every=2)
                    + [(round(type_end + 0.2, 3), "pop", -10.0)])
        if t == "race":                                 # prompt types .6-1.5, code streams, the freeze at 70 %
            stop = d * 0.70
            return ([(0.1, "whoosh", -9.0)] + keys(0.6, 22, 0.04, -19.0, every=2)
                    + [(round(1.7 + i * 0.32, 3), "typekey", -22.0) for i in range(int((stop - 1.7) / 0.32))]
                    + [(round(stop, 3), "hit", -4.0), (round(stop + 0.05, 3), "whoosh", -9.0)])
        if t == "hand":
            n = min(5, len(sc.get("cards") or []))
            out = [(0.02, "whoosh", -8.0)] + [(round(0.62 + i * 0.09 + 0.3, 3), "paper", -13.0) for i in range(n)]
            if str(sc.get("hero", "")) != "-1":
                pull = float(sc.get("pull_at") or min(max(d - 3.6, 2.2), 2.9))
                out += [(round(pull, 3), "whoosh", -6.0), (round(pull + 0.85, 3), "hit", -7.0)]
            return out
        if t == "tally":                                # drums land .55+i*step+.9, left to right; the pull-back follows
            txt = str(sc.get("text") or "") or (str(sc.get("prefix") or "") + f"{float(sc.get('value') or 0):,.{int(sc.get('decimals') or 0)}f}" + str(sc.get("suffix") or ""))
            n = sum(ch.isdigit() for ch in txt)
            step = min(0.42, 1.6 / (n - 1)) if n > 1 else 0.0
            lands = [0.55 + i * step + 0.9 for i in range(n)]
            return ([(0.05, "riser", -14.0), (0.35, "whoosh", -12.0)] + [(round(x, 3), "tap", -11.0) for x in lands[:-1]]
                    + ([(round(lands[-1], 3), "hit", -4.0)] if lands else []))
        if t == "bigline":
            n = len(str(sc.get("line") or "").split())
            return [(0.0, "whoosh", -9.0), (round(0.15 + n * 0.075 + 0.35, 3), "hit", -11.0)]
    return [(0.0, "whoosh", -6.0)]


# the ANALOG kit's drum voices: row name -> (sfx.BANK sound, dB relative to the channel's sfx level)
_DRUM = {"bd": ("bd808", 14.0), "kick": ("bd808", 14.0), "808": ("bd808", 14.0), "acou": ("kickac", 11.0),
         "sd": ("sd808", 10.0), "snar": ("sd808", 10.0), "cp": ("cp808", 9.0), "clap": ("cp808", 9.0),
         "ch": ("ch808", 6.0), "hat": ("ch808", 6.0), "oh": ("oh808", 6.0), "open": ("oh808", 6.0),
         "cb": ("cb808", 7.0), "cowb": ("cb808", 7.0), "rs": ("rs808", 6.0), "lt": ("tom808", 8.0), "mt": ("tom808", 8.0),
         "ht": ("tom808", 8.0), "cy": ("oh808", 5.0), "ma": ("rs808", 3.0), "cl": ("rs808", 5.0)}


def _pattern_marks(sc: dict) -> list:
    """The 16-step pattern the steps scene shows, as sounds on its playhead (the JS starts it at 1.0 s)."""
    rows = sc.get("rows") or {}
    if isinstance(rows, list):
        rows = {str(o.get("name") or o.get("k") or ""): str(o.get("steps") or o.get("v") or "") for o in rows if isinstance(o, dict)}
    try:
        bpm = max(60.0, min(180.0, float(sc.get("bpm") or 100)))
    except (TypeError, ValueError):
        bpm = 100.0
    step, t0, end = 60.0 / bpm / 4, 1.0, float(sc.get("duration", 7.0)) - 0.5
    pats = []
    for name, steps in list(rows.items())[:5]:
        hits = [c in "xX1*o" for c in re.sub(r"[\s|]", "", str(steps))][:32]
        voice = _DRUM.get(str(name).lower()[:2]) or _DRUM.get(str(name).lower()[:4])
        if hits and voice:
            pats.append((hits, voice))
    out, k = [], 0
    while t0 + k * step < end:
        for hits, (snd, gain) in pats:
            if hits[k % len(hits)]:
                out.append((round(t0 + k * step, 4), snd, gain))
        k += 1
    return out


# ── the designer (when there is no director) ─────────────────────────────────────
SCENES_PROMPT = """You are the motion designer of a YouTube channel whose graphics language is "[INSERT KIT HERE]".
The video is titled "[INSERT TITLE HERE]". Its narration is in [INSERT LANGUAGE HERE]; every text on screen is in that language too.
[INSERT EXTRA HERE]
The narration below is split into numbered PARTS. For EACH part choose at most ONE graphic from the list, or "none" — a
graphic only where the words call for it: a fact, a name, a place, a turn, a joke this kit is built for. Never
retype the narration as a card. Real names, real numbers, real dates only — never invented.

THE GRAPHICS OF THIS KIT
[INSERT TYPES HERE]

Answer with a JSON array, one object per part, in order, each carrying "part", "at" (4-8 consecutive words copied
exactly from that part, where the graphic starts) and the graphic's fields as shown, or {"part": n, "type": "none"}.

[INSERT CHUNKS HERE]"""


def _normalise(kit: str, raw: dict) -> dict:
    """A scene the JS can draw, or None."""
    if not isinstance(raw, dict):
        return None
    t = str(raw.get("type") or "").lower().strip()
    if t not in KITS[kit]["types"]:
        return None
    sc = {k: v for k, v in raw.items() if k not in ("tool", "cue", "words", "at", "part", "at_s", "dur", "end_cue")}
    sc["type"] = t
    sc["kit"] = kit
    if kit == "almanac" and t == "hand":
        # a hand holds 2-5 cards: the scene throws on any other count, and one thrown scene fails the kit's batch
        given = sc.get("cards") if isinstance(sc.get("cards"), list) else []
        keep = [(i, c) for i, c in enumerate(given) if isinstance(c, dict) and str(c.get("name") or "").strip()][:5]
        if len(keep) < 2:
            return None
        sc["cards"] = [c for _, c in keep]
        # the hero is an index into the director's list: it follows its card through the filter, and when that card
        # was left out nobody is pulled — another card would fly to the lens under the first one's hero_title
        if sc.get("hero") is not None:
            h, idx = sc["hero"], None
            if isinstance(h, str) and h.strip() and not re.fullmatch(r"\s*-?\d+(\.\d+)?\s*", h):
                idx = next((i for i, c in keep if str(c.get("name") or "").strip().lower() == h.strip().lower()), None)
            else:
                try:
                    idx = int(round(float(h)))
                except (TypeError, ValueError):
                    idx = None
            new = next((j for j, (i, _) in enumerate(keep) if i == idx), None) if idx is not None else None
            sc["hero"] = -1 if new is None else new
            if new is None:
                sc.pop("hero_title", None)
                sc.pop("hero_text", None)
    if kit == "almanac" and t == "tally" and not str(sc.get("text") or "").strip():
        # the drums read one plain number: "100,000,000", "$1.2bn" or "40%" become it, anything else leaves the tally
        # out — "100 million" once rang up as $100, and a wrong figure on screen is worse than none
        got = _tally_value(sc.get("value"))
        if got is None:
            return None
        sc["value"], pre, add = got
        if isinstance(sc["value"], float) and sc.get("decimals") is None:
            # the drums print decimals only when told: 4.2 would ring up as 4
            sc["decimals"] = min(3, len(repr(sc["value"]).split(".")[1].rstrip("0")) if "." in repr(sc["value"]) else 0)
        if pre and not str(sc.get("prefix") or "").strip():
            sc["prefix"] = pre
        if add and not str(sc.get("suffix") or "").startswith(add):
            sc["suffix"] = add + str(sc.get("suffix") or "")
    return sc


_TALLY_ABOUT = re.compile(r"^(?:about|around|approximately|approx\.?|roughly|nearly|almost|over|more than|some|circa|"
                          r"ca\.|c\.|~|≈)\s*", re.I)
_TALLY_CUR = re.compile(r"^(US\$|\$|€|£|¥|₹)\s*")
_TALLY_MULT = {"thousand": 10 ** 3, "million": 10 ** 6, "mn": 10 ** 6, "mln": 10 ** 6, "mil": 10 ** 6,
               "billion": 10 ** 9, "bn": 10 ** 9, "bln": 10 ** 9, "trillion": 10 ** 12, "tn": 10 ** 12, "trn": 10 ** 12}
_TALLY_SHORT = {"k": 10 ** 3, "m": 10 ** 6, "b": 10 ** 9, "t": 10 ** 12}   # only after a currency sign: "100m" alone
                                                                            # may be metres, "40t" tonnes


def _tally_value(v):
    """ALMANAC tally: the figure a model wrote, as (number, prefix, suffix) for the drums — or None when it is not one
    plain number. "$1.2bn" -> (1200000000, "$", ""), "about 4.2 billion" -> 4200000000, "40%" -> (40, "", "%"),
    "1,000+" -> (1000, "", "+"), "1e6" -> 1000000. Words that are not a multiplier ("100 million dollars", "1-2
    million") are never guessed at."""
    from decimal import Decimal, InvalidOperation
    if isinstance(v, bool) or v is None:
        return None
    if isinstance(v, (int, float)):
        return (v, "", "") if math.isfinite(v) else None
    s, prev = re.sub(r"\s+", " ", str(v)).strip(), None
    while s != prev:
        prev, s = s, _TALLY_ABOUT.sub("", s).strip()
    pre, add = "", ""
    m = _TALLY_CUR.match(s)
    if m:
        pre, s = m.group(1), s[m.end():]
    while s and s[-1] in "%+":
        add, s = s[-1] + add, s[:-1].strip()
    s = re.sub(r"(?<=\d)[    '_](?=\d{3}(?!\d))", "", s)        # 1 000 000, 1'000
    s = re.sub(r"(?<=\d),(?=\d{3}(?!\d))", "", s)                                # 1,000,000
    if re.fullmatch(r"-?\d+,\d{1,2}(?: ?[a-z]+)?", s, re.I):                     # 4,2 million
        s = s.replace(",", ".", 1)
    m = re.fullmatch(r"(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?) ?([a-z]+)?", s, re.I)
    if not m:
        return None
    try:
        num = Decimal(m.group(1))
    except InvalidOperation:
        return None
    word = (m.group(2) or "").lower()
    if word:
        mult = _TALLY_MULT.get(word) or (_TALLY_SHORT.get(word) if pre else None)
        if not mult:
            return None
        num *= mult
    if not num.is_finite():
        return None
    return (int(num) if num == num.to_integral_value() else float(num)), pre, add


def _hand_hero(hero, n: int) -> int:
    """The card hand.js pulls (its own rule): the last one when no hero is given, -1 (none) for a value it cannot
    read, otherwise the index rounded into -1 … n-1."""
    if hero is None:
        return n - 1
    try:
        h = float(hero) if not isinstance(hero, str) or hero.strip() else 0.0
    except (TypeError, ValueError):
        return -1
    if h != h:
        return -1
    return int(max(-1, min(n - 1, math.floor(h + 0.5))))


def design(engine, srt: Path, job: Path, total: float, force: bool, style: str, step_s: float, title: str = "") -> list:
    """Claude's design per part (motion/doc_scenes.json) — the same file the director writes, so whichever ran first wins."""
    log = engine.log
    kit = kit_for_style(engine, style)
    mo_dir = job / "motion"
    mo_dir.mkdir(exist_ok=True)
    spec_file = mo_dir / "doc_scenes.json"
    entries = engine._parse_srt_full(srt.read_text(encoding="utf-8"))
    n = max(1, int(math.ceil(total / step_s)))
    if spec_file.exists() and not force:
        try:
            specs = json.loads(spec_file.read_text(encoding="utf-8"))
            if isinstance(specs, dict) or len(specs) >= n:
                return specs
        except ValueError:
            pass
    chunks = ["" for _ in range(n)]
    for a, b, txt in entries:
        i = int(a // step_s)
        if 0 <= i < n:
            chunks[i] += " " + txt
    if not title and (job / "title.txt").exists():
        title = (job / "title.txt").read_text(encoding="utf-8").splitlines()[0]
    body = "\n\n".join(f"PART {i + 1} ({int(i * step_s) // 60}:{int(i * step_s) % 60:02d}):\n"
                       f"{(chunks[i].strip() or '(quiet)')[:1500]}" for i in range(n))
    log(f"Claude: designing {KITS[kit]['label']} graphics for {n} parts...")
    try:
        specs = engine._json_items(SCENES_PROMPT.replace("[INSERT KIT HERE]", KITS[kit]["label"])
                                   .replace("[INSERT TITLE HERE]", title or "")
                                   .replace("[INSERT LANGUAGE HERE]", engine._job_language(job, style))
                                   .replace("[INSERT EXTRA HERE]", engine._extra_block())
                                   .replace("[INSERT TYPES HERE]", prompt_block(kit))
                                   .replace("[INSERT CHUNKS HERE]", body), max_tokens=max(4000, n * 300))
    except SystemExit as e:
        log(f"kits: Claude's answer did not parse — no graphics this time ({str(e)[:100]})")
        return []
    spec_file.write_text(json.dumps(specs, indent=1, ensure_ascii=False), encoding="utf-8")
    return specs


def _words_at(job: Path, words: str, near: float, window: float = 12.0):
    """The second the narrator starts saying `words` (a phrase from the script), found in words_heard.json within
    `window` s of `near` — the longest run of the phrase's words in order wins; None when nothing matches."""
    import re as _re
    norm = lambda w: _re.sub(r"[^a-z0-9]", "", str(w).lower())
    want = [norm(w) for w in words.split() if norm(w)]
    if not want:
        return None
    try:
        heard = json.loads((job / "words_heard.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    seq = []
    for h in heard:
        try:
            seq.append((norm(h[0]), float(h[1])))
        except (TypeError, ValueError, IndexError):
            continue
    best, best_n = None, 0
    for i, (w, t) in enumerate(seq):
        if abs(t - near) > window or w != want[0]:
            continue
        n = 1
        while n < len(want) and i + n < len(seq) and seq[i + n][0] == want[n]:
            n += 1
        if n > best_n or (n == best_n and best is not None and abs(t - near) < abs(best - near)):
            best, best_n = t, n
    return best if best_n >= min(2, len(want)) else None


def _spoken_at(job: Path, at: float, words: list, window: float = 7.0) -> list:
    """For each word, the second (relative to `at`) the narrator says it — from words_heard.json (whisper's word
    times), the nearest match within `window` s after the scene starts; unmatched words fall back to an even
    spacing after the previous one."""
    import re as _re
    try:
        heard = json.loads((job / "words_heard.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    norm = lambda w: _re.sub(r"[^a-z0-9]", "", str(w).lower())
    out, last = [], -1.0
    for w in words:
        key = norm(w)
        best = None
        for h in heard:
            try:
                hw, hs = norm(h[0]), float(h[1])
            except (TypeError, ValueError, IndexError):
                continue
            if hw != key or hs < at - 0.4 or hs > at + window or hs - at <= last:
                continue
            best = hs - at
            break
        if best is None:
            best = (last + 0.9) if last >= 0 else 0.0
        out.append(round(max(0.0, best), 2))
        last = out[-1]
    return out


def _grounds(kit: str, t: str) -> tuple:
    """(blur, brightness, saturation) of the footage frame under a scene type."""
    sharp = {"newsbar": (0, 0.92, 1.0), "label": (0, 0.95, 1.0), "moneyrain": (0, 0.9, 1.0), "corner": (0, 0.95, 1.0),
             "lower": (0, 0.95, 1.0), "page": (0, 1.0, 1.0), "phones": (0, 1.0, 1.0), "tracker": (0, 0.9, 0.0),
             "stamp": (0, 0.95, 1.0), "wave": (0, 1.0, 1.0), "board": (0, 1.0, 1.0), "doodle": (10, 0.3, 0.5),
             "stencil": (1.5, 0.7, 0.8), "maproom": (0, 0.9, 0.9), "mosaic": (4, 0.7, 0.8), "bigword": (3, 0.55, 0.8),
             "player": (0, 1.0, 1.0), "timeline": (0, 0.95, 1.0), "post": (9, 0.4, 0.7), "subs": (9, 0.35, 0.6), "title": (10, 0.45, 0.7), "chapter": (7, 0.6, 0.85), "line": (7, 0.55, 0.8),
             "title_gold": (8, 0.35, 0.5), "crosshair": (2, 0.75, 0.7), "alert": (6, 0.75, 0.6)}
    if kit == "analog":
        own = {"machine": (10, 0.36, 0.7), "steps": (18, 0.25, 0.5), "wave": (18, 0.22, 0.5), "record": (22, 0.36, 0.8),
               "price": (12, 0.38, 0.7), "units": (14, 0.3, 0.6), "timeline": (10, 0.4, 0.75), "quote": (16, 0.32, 0.6),
               "city": (0, 0.78, 0.95)}
        if t in own:
            return own[t]
    if kit == "horizon" and t == "tab":
        return (0, 0.85, 0.95)                                # the chapter tab sits over the sharp footage
    return sharp.get(t, (8, 0.5, 0.75))



def _chat_answer(engine, job: Path, sc: dict, log=print) -> str:
    """The REAL reply of the model a chat scene names, cached per model and prompt.

    The scene shows a model answering, so the answer has to be that model's own: a
    reply written to look like one is a test that never happened. Anthropic models are
    asked through the pipeline's own Claude route; a Gemini model only with an explicit
    `api_model` (the name on screen does not say which API model it is) and a key. Any
    other model returns "" and the scene is left out rather than filled in."""
    import hashlib, os, requests
    model, prompt = str(sc.get("model") or "").strip(), str(sc.get("prompt") or "").strip()
    if not model or not prompt:
        return ""
    cache = job / "motion" / "chat_answers.json"
    try:
        known = json.loads(cache.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        known = {}
    key = hashlib.sha1(f"{model}\n{prompt}".encode()).hexdigest()[:16]
    if known.get(key):
        return known[key]
    low = model.lower()
    ans = ""
    try:
        if any(w in low for w in ("claude", "opus", "sonnet", "haiku", "fable", "mythos")):
            mid = "claude-" + re.sub(r"[^a-z0-9]+", "-", low.replace("claude", "")).strip("-")
            ans = engine.claude(prompt, mid, max_tokens=900)
        elif "gemini" in low and sc.get("api_model") and os.environ.get("GEMINI_API_KEY"):
            r = requests.post(f"https://generativelanguage.googleapis.com/v1beta/models/{sc['api_model']}:generateContent",
                              params={"key": os.environ["GEMINI_API_KEY"]},
                              json={"contents": [{"parts": [{"text": prompt}]}]}, timeout=120)
            r.raise_for_status()
            ans = "".join(pt.get("text", "") for pt in r.json()["candidates"][0]["content"]["parts"])
    except Exception as e:                                        # noqa: BLE001
        log(f"  kits: chat — {model} did not answer ({str(e)[:90]}); the scene is left out")
        return ""
    ans = (ans or "").strip()
    if ans:
        known[key] = ans
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_text(json.dumps(known, indent=1, ensure_ascii=False), encoding="utf-8")
    return ans

_seen_faces: dict = {}      # job -> {person: {photo paths already used}}
_alm_seen: dict = {}        # job -> {"keys": {photo digests}, "hashes": [average hashes]}: ALMANAC's photos on screen
_VIDEO = (".mp4", ".mov", ".m4v", ".webm", ".mkv")


def _alm_remember(job: Path, photo) -> bool:
    """ALMANAC's one-picture rule: True — and the photo is remembered — when this video has not shown this photograph
    yet. Judged by the picture, not its path: the same photo found for two scenes sits in two scene folders, and a
    copy from another site has other bytes but the same average hash."""
    import photofx
    seen = _alm_seen.setdefault(str(job), {"keys": set(), "hashes": []})
    key, h = photofx.digest(photo), photofx._phash(photo)
    if key in seen["keys"] or any(photofx._same_photo(h, x) for x in seen["hashes"]):
        return False
    seen["keys"].add(key)
    seen["hashes"].append(h)
    return True


def _alm_person(engine, job: Path, folder: Path, who: str, query: str, took: list = None) -> str:
    """ALMANAC: a real photo of a person, its background removed and cropped to the figure — a picture this video
    has not shown yet (photofx keeps up to three per search). "" when there is none: the scene renders without it.
    The photo itself is added to `took`, so a cached scene can say again which pictures it shows."""
    who, query = str(who or "").strip(), str(query or "").strip()
    if not (who or query):
        return ""
    try:
        import almanac_prep
        import photofx
        picks = photofx.source_photos(engine, who or query, query or who, folder, n=3)
        photo = next((str(p["photo"]) for p in picks if _alm_remember(job, p["photo"])), "")
        if not photo:
            return ""
        if took is not None:
            took.append(photo)
        cut = photofx.cutout(photo, job / "photofx" / "cut", log=engine.log)
        return str(almanac_prep.trim_cutout(Path(cut), job / "photofx" / "cut"))
    except Exception as e:                                        # noqa: BLE001 - a photo never fails a render
        engine.log(f"  kits: no cut-out of {who or query!r} — {str(e)[:100]}")
        return ""


def _alm_thing(engine, job: Path, folder: Path, thing: str) -> str:
    """ALMANAC: a real object, photographed, cut out and trimmed (photofx.source_thing), or ""."""
    try:
        import photofx
        got = photofx.source_thing(engine, str(thing), folder, job / "photofx" / "cut", min_side=720)
        return str(got.get("png") or "")
    except Exception as e:                                        # noqa: BLE001
        engine.log(f"  kits: no cut-out of {str(thing)!r} — {str(e)[:100]}")
        return ""


def _alm_clips(job: Path, pics: list, at: float, used: set, n: int) -> list:
    """The video's own archive footage (YouTube / Internet Archive clips, docgfx._pictures) nearest `at` that no
    other scene has taken: [(path, seconds)], seconds 0 when footage_seconds.json does not know the clip. Stock
    clips never play in the film strip: modern stock in a 1920s strip is what the style's footage taste rules out."""
    try:
        secs = json.loads((job / "footage_seconds.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        secs = {}
    out = []
    for _, p in sorted((p for p in pics if p[0] >= 0 and Path(p[1]).suffix.lower() in _VIDEO
                        and Path(p[1]).parent.name != "pexels"
                        and str(p[1]) not in used and Path(p[1]).exists()), key=lambda p: abs(p[0] - at)):
        d = float(secs.get(Path(p).name) or 0)
        if 0 < d < 1.0:                                           # too short to show a moment
            continue
        out.append((Path(p), d))
        if len(out) >= n:
            break
    return out


def _alm_fill(got: list, need: float, cap: float = 8.0) -> list:
    """Clips (nearest first, from _alm_clips) that together run `need` seconds: the nearest one that lasts alone,
    else the longest, then the next ones until the film is long enough — a film that runs out freezes on its last
    frame (a real shot is 4.5 s at the median, a reel's gate wants 5+). A clip of unknown length counts as 6.5 s."""
    out, have, rest = [], 0.0, list(got)
    while rest and have < need - 0.05 and len(out) < 3:
        left = need - have
        pick = next((g for g in rest if (g[1] or 6.5) >= left), None) or max(rest, key=lambda g: g[1] or 6.5)
        rest.remove(pick)
        take = min(pick[1] or 6.5, left + 0.3, cap)
        out.append({"src": str(pick[0]), "in": 0.0, "out": round(take, 2)})
        have += take
    return out


def _reel_clock(sc: dict, d: float, film: bool = None) -> dict:
    """reel.js's clock, from its own constants (reel_transport and SCENES.reel.build): whether it dives (never without
    film, nor under 6.6 s), the dive `tz` (open_at, default 5.1, kept in 3.6 … D − 3.0), the strip's rest `tr` (just
    before the dive, 5.08 s at most), the spin's peak `tp`, and — the spin keeps its shape for every tr — when the
    strip coasts under 18 px/frame (`slow`: the cells can be read) and under 1 px/frame (`rest`)."""
    if film is None:
        fo = sc.get("footage")
        film = bool(fo) if isinstance(fo, list) else bool(isinstance(fo, dict) and (fo.get("frames") or fo.get("clips")))
    v = sc.get("open_at")
    try:
        tz = float(v) if v is not None and not isinstance(v, bool) and str(v).strip() else 5.1
    except (TypeError, ValueError):
        tz = 5.1
    tz = max(3.6, min(d - 3.0, tz if math.isfinite(tz) else 5.1))
    dive = sc.get("open") is not False and d >= 6.6 and film
    tr = max(2.2, min(5.08, tz - 0.02 if dive else d - 0.5))
    tp = 1.1 + min(max((tr - 1.1) / 3.98, 0.5), 1.0)
    return {"dive": dive, "tz": tz, "tr": tr, "tp": tp, "slow": tp + 0.47 * (tr - tp), "rest": tp + 0.77 * (tr - tp)}


# the film strip's cells in the order reel.js hands the listed clips to them (reel_plan: the most readable first) and
# how long each one shows its clip in a 9.6 s reel: the two that rest beside the gate, the three that glide under the
# title, the one that slides past into the left edge, the strip's head. A shorter reel needs less of each.
_REEL_CELLS = (3.6, 3.6, 1.8, 1.8, 1.8, 3.0, 1.5)


def _alm_reel(job: Path, pics: list, at: float, used: set, dur: float, sc: dict) -> list:
    """The film strip's clips — reel.js prints every cell with its own shot: up to 8 of the video's own archive clips
    nearest the scene that no other scene plays (_alm_clips), one per source video first (two moments of one video
    are often one scene), chosen among the nearest 16 so the strip stays on this part of the story. It takes 6 when
    the video has them — the gate, the two cells that rest beside it and the three that glide under the title each
    get their own shot (fewer, and the cells you can read repeat one) — and a third of a larger archive, up to the 8,
    so the timeline keeps its footage. The gate — the shot the camera dives into, full frame to the end, under the
    tab that names the place — is the nearest clip that lasts from where the strip slows down to the end, one found
    for words that name the tab's place first; else the longest, so it never runs out (reel.js holds a shorter one's
    first frame while it comes in); it goes last, marked "gate". The others follow nearest first, each cut to what
    its cell shows."""
    got = _alm_clips(job, pics, at, used, 10 ** 6)
    if not got:
        return []
    want, near = min(8, len(got), max(6, len(got) // 3)), got[:16]
    try:
        rows = json.loads((job / "youtube" / "clips.json").read_text(encoding="utf-8"))
        known = {str(Path(r["path"])): (str(r.get("video") or ""), float(r.get("dur") or 0),
                                        f"{r.get('need') or ''} {r.get('line') or ''}")
                 for r in rows if isinstance(r, dict) and r.get("path")}
    except (OSError, ValueError, TypeError):
        known = {}

    def secs(g):                                                  # footage_seconds.json, else the clip list's own
        return g[1] or known.get(str(g[0]), ("", 0.0, ""))[1]

    def video(g):
        return known.get(str(g[0]), ("", 0.0, ""))[0] or str(g[0])

    def words(s) -> str:                                          # "Washington D.C." -> " washington dc "
        return " " + " ".join(re.sub(r"\W+", " ", re.sub(r"[.'’]", "", str(s or "").lower())).split()) + " "

    lab = sc.get("label") if isinstance(sc.get("label"), dict) else {}
    place = words(str(lab.get("name") or "").split(",")[0])           # "Chicago, Illinois" -> " chicago "
    clock = _reel_clock(sc, dur, film=True)
    lasts = dur - clock["slow"]                                   # a clip of unknown length counts as 6.5 s
    lasting = [g for g in near if (secs(g) or 6.5) >= lasts]
    # the tab names the place the film lands in: a clip found for words that name that place is dived into first
    named = [g for g in lasting if place.strip() and place in words(known.get(str(g[0]), ("", 0.0, ""))[2])]
    gate = (named or lasting or [max(near, key=lambda g: secs(g) or 6.5)])[0]
    # one clip per source video, nearest first; then a second moment of each video before a third of any
    rest, count = [], {video(gate): 1}
    while len(rest) < want - 1:
        left = [g for g in near if g is not gate and g not in rest]
        if not left:
            break
        g = min(left, key=lambda g: count.get(video(g), 0))        # the nearest of the least shown
        rest.append(g)
        count[video(g)] = count.get(video(g), 0) + 1
    out = [{"src": str(g[0]), "in": 0.0, "out": round(min(secs(g) or c, c), 2)} for g, c in zip(rest, _REEL_CELLS)]
    cap = max(1.0, dur - clock["tp"])                             # the gate is on screen from about the spin's peak
    return out + [{"src": str(gate[0]), "in": 0.0, "out": round(min(secs(gate) or cap, cap), 2), "gate": True}]


def _alm_given(v, job: Path):
    """A picture the director wrote into an ALMANAC scene itself, kept only when it can be shown: a data: image, or
    an existing image file (a path, or the prep's {"src": path, ...}), made absolute. Anything else — a person's
    name, a URL, a list — is dropped and the picture is fetched as usual: a stray string reached the page, failed
    to decode, and took the kit's whole batch down with it."""
    import almanac_prep
    src = v.get("src") if isinstance(v, dict) else v
    if not isinstance(src, str) or not src.strip():
        return None
    if src.startswith("data:image/"):
        return v
    p = Path(src).expanduser()
    p = p if p.is_absolute() else job / p
    if p.suffix.lower() not in almanac_prep.IMG_EXT or not p.is_file():
        return None
    return dict(v, src=str(p)) if isinstance(v, dict) else str(p)


def _almanac_media(engine, job: Path, k: int, at: float, sc: dict, pics: list, used: set) -> dict:
    """The real pictures of one ALMANAC scene, found before it is rendered: a person's cut-out for bar, register,
    cardwall and tally (subject + query), an object's for card (thing), one per listed person for hand, and the
    video's own archive film nearest the scene for reel, cardwall and tally's bar. Then almanac_prep turns the film
    into frames, cached in the job (motion/almanac). Every miss leaves its key out and the scene renders without it.
    Returns {"clips": the clips it put on screen (so the timeline leaves them out), "photos": the photographs it
    shows (so a cached scene can claim them again), "drop": True when the scene should not play at all}."""
    import almanac_prep
    t, folder = sc["type"], job / "photofx" / f"kit_{k:02d}"
    took: list = []

    def put(d: dict, key: str, val):
        if val:
            d[key] = val
        else:
            d.pop(key, None)

    def person(o: dict, where: Path) -> str:
        return _alm_person(engine, job, where, o.get("subject") or "", o.get("query") or "", took)

    # what the director wrote itself is only kept when it is a real picture (a name in "media" crashed the run)
    for key in ("photo", "cutout", "portrait", "image", "media"):
        if key in sc:
            put(sc, key, _alm_given(sc[key], job))
    for c in sc.get("cards") or []:
        if isinstance(c, dict) and "image" in c:
            put(c, "image", _alm_given(c["image"], job))
    fo = sc.get("footage")
    if fo is not None and not (isinstance(fo, list) or (isinstance(fo, dict) and (fo.get("clips") or fo.get("frames")))):
        sc.pop("footage", None)

    drop = False
    try:
        if t == "bar" and not sc.get("photo"):
            put(sc, "photo", _alm_person(engine, job, folder, sc.get("subject") or sc.get("name") or "",
                                         sc.get("query") or "", took))
        elif t == "card" and not sc.get("photo"):
            got = _alm_thing(engine, job, folder, sc["thing"]) if sc.get("thing") else ""
            if not got and (sc.get("thing") or sc.get("subject")):
                # no clean cut-out of the object (news photos of a product rarely cut out whole): its real photo the
                # person's way — search, pick, remove the background — which found the engine the object search missed
                got = _alm_person(engine, job, folder / "photo", sc.get("subject") or sc.get("thing") or "",
                                  sc.get("query") or sc.get("thing") or "", took)
            put(sc, "photo", got)
        elif t == "hand":
            cards = [c for c in sc.get("cards") or [] if isinstance(c, dict)]
            for i, c in enumerate(cards):
                if not c.get("image"):
                    put(c, "image", _alm_person(engine, job, job / "photofx" / f"kit_{k:02d}_{i}",
                                                c.get("subject") or c.get("name") or "", c.get("query") or "", took))
            # a card without its photo is a blank collector's card: those are left out, and a hand with fewer than
            # two photos left is no hand. The hero is pulled only with its photo (another card would fly to the lens
            # under the first one's hero_title)
            shown = [c for c in cards if c.get("image")]
            hero = _hand_hero(sc.get("hero"), len(cards))
            if len(shown) < 2:
                drop = True
            elif len(shown) < len(cards) or hero >= 0:
                sc["cards"] = shown
                if hero >= 0 and cards[hero].get("image"):
                    sc["hero"] = next(j for j, c in enumerate(shown) if c is cards[hero])
                else:
                    sc["hero"] = -1
                    sc.pop("hero_title", None)
                    sc.pop("hero_text", None)
        elif t == "register" and not (sc.get("media") or {}).get("src"):
            cut = person(sc, folder)
            put(sc, "media", {"kind": "cutout", "src": cut} if cut else None)
        elif t == "tally" and not (sc.get("portrait") or sc.get("cutout")):
            if sc.get("thing"):
                put(sc, "cutout", _alm_thing(engine, job, folder, sc["thing"]))
            elif sc.get("skin") != "card":                        # the card skin shows an object, not a person
                put(sc, "portrait", person(sc, folder))
        elif t == "cardwall" and not sc.get("cutout"):
            put(sc, "cutout", person(sc, folder))
    except Exception as e:                                        # noqa: BLE001 - a picture never fails a render
        engine.log(f"  kits: almanac {t} plays without its pictures — {str(e)[:120]}")

    clips = []
    if t == "reel" and not sc.get("footage"):
        # every cell of the strip its own shot, the gate clip last (_alm_reel). A clip that cannot be prepared (gone,
        # unreadable) is left out on its own instead of taking the whole film with it; the frames made here are the
        # ones the prep below finds in the cache
        fo = {"fps": 15, "width": 960, "crop_y": 0.5, "levels": "auto"}
        for c in _alm_reel(job, pics, at, used, float(sc.get("duration") or 9.6), sc):
            try:
                almanac_prep.prep_footage(dict(fo, clips=[c]), job, job / "motion" / "almanac", "reel")
                clips.append(c)
            except Exception as e:                                # noqa: BLE001 - one clip never costs the film
                engine.log(f"  kits: the reel leaves out {Path(c['src']).name} — {str(e)[:100]}")
        if clips and not any(c.get("gate") for c in clips):
            # the gate clip was the one left out: the longest one left is dived into instead
            g = max(clips, key=lambda c: c["out"] - c["in"])
            clips.remove(g)
            clips.append(dict(g, gate=True))
        if clips:
            sc["footage"] = dict(fo, clips=clips)
        else:
            sc["open"] = False
    elif t == "cardwall" and not sc.get("footage") and not sc.get("image"):
        got = _alm_clips(job, pics, at, used, 1)
        if got:
            clips = [{"src": str(got[0][0]), "in": 0.0, "out": 3.2}]
            sc["footage"] = {"clips": clips, "fps": 15, "width": 1280, "focus_y": 0.45, "grade": "mono"}
        else:
            sc["split_at"] = 0.25                                 # no film to open on: crack at once
    elif t == "tally" and sc.get("portrait") and sc.get("skin") != "card" and not sc.get("footage"):
        # the film runs inside the dark bar under the yellow figure for the whole scene (held dark so the numerals
        # stay the picture): the nearest clip that lasts it, else two or three in a row
        clips = _alm_fill(_alm_clips(job, pics, at, used, 4), float(sc.get("duration") or 6.8) + 0.5)
        if clips:
            sc["footage"] = {"clips": clips, "fps": 12, "width": 1280, "focus_y": 0.55, "bright": 0.5}
    try:
        sc.update(almanac_prep.prep_scene(sc, base=job, cache=job / "motion" / "almanac"))
    except Exception as e:                                        # noqa: BLE001 - film never fails a render
        engine.log(f"  kits: almanac {t} plays without its film — {str(e)[:120]}")
        sc.pop("footage", None)
        if t == "reel":
            sc["open"] = False
        clips = []
    shown = [c["src"] for c in clips]
    used.update(shown)
    return {"clips": shown, "photos": took, "drop": drop}


def generate(engine, srt: Path, job: Path, total: float, force: bool, style: str, step_s: float, seg_dur: float,
             title: str = "") -> list:
    """[(start, path, dur)] — this kit's graphics for one video, each on the words it belongs to."""
    import docgfx
    import motion                       # image_data_uri: a cutout PNG keeps its alpha
    log = engine.log
    kit = kit_for_style(engine, style)
    if not kit:
        return []
    st = engine.STYLE_INFO.get(style) or {}
    look = st.get("look") or {}
    max_s = float((st.get("pacing") or {}).get("graphic_max_s") or 9.0)
    if not title and (job / "title.txt").exists():
        title = (job / "title.txt").read_text(encoding="utf-8").splitlines()[0].strip()
    mo_dir = job / "motion"
    mo_dir.mkdir(exist_ok=True)
    entries = engine._parse_srt_full(srt.read_text(encoding="utf-8"))
    n = max(1, int(math.ceil(total / step_s)))
    specs = design(engine, srt, job, total, force, style, step_s, title)
    if not specs:
        return []
    lengths = durations(kit)
    placed, last_end = [], -3.0
    if isinstance(specs, dict):
        for raw in specs.get("items") or []:
            sc = _normalise(kit, raw)
            if sc is None:
                continue
            dur = min(max_s, lengths[sc["type"]])
            if sc["type"] == "flipchart":                     # two pages need no seven seconds: no page holds still
                dur = min(dur, 2.6 + 1.8 * max(0, len(sc.get("pages") or []) - 1))
            if raw.get("dur"):
                try:
                    dur = min(max_s, max(_min_s(kit, sc["type"]), float(raw["dur"])))
                except (TypeError, ValueError):
                    pass
            # a graphic lives on its words: it starts where they are spoken, never seconds later. If the previous
            # scene is still running, that one is cut short (down to 2 s, or the kit's min_s); when even that is not
            # enough, the new scene is left out — a big word arriving five seconds after it was said reads as a mistake
            want = max(float(raw.get("at_s") or 0) - 0.15, 0.0)
            # the director's time is a cue's; the graphic belongs to its WORDS — whisper knows where they are said
            heard_at = _words_at(job, str(raw.get("words") or ""), float(raw.get("at_s") or 0))
            if heard_at is not None:
                want = max(heard_at - 0.15, 0.0)
            at = want
            if placed and at < last_end + 0.4:
                p_at, p_sc = placed[-1]
                if last_end + 0.4 - want <= 1.2:              # a second late is fine — the eye does not notice
                    at = last_end + 0.4
                else:
                    room = at - 0.4 - p_at
                    if room >= _min_s(kit, p_sc["type"]):
                        p_sc["duration"] = min(p_sc["duration"], round(room, 2))
                        last_end = p_at + p_sc["duration"]
                    else:
                        continue
            if at + dur > total - 0.5:
                # the video ends first: a kit that knows how short each scene still plays in full (min_s) shortens
                # it down to that, else the scene is left out
                if not KITS[kit].get("min_s") or total - 0.5 - at < _min_s(kit, sc["type"]):
                    continue
                dur = round(total - 0.5 - at, 2)
            sc["duration"] = dur
            placed.append((at, sc))
            last_end = at + dur
    else:
        stream = engine._spoken_stream(entries) if hasattr(engine, "_spoken_stream") else None
        for i, raw in enumerate(specs[:n]):
            sc = _normalise(kit, raw)
            if sc is None:
                continue
            part = int(raw.get("part") or (i + 1)) - 1 if str(raw.get("part") or "").isdigit() else i
            lo, hi = part * step_s, (part + 1) * step_s
            at = engine._find_line(stream, raw.get("at") or "", lo, lo, hi) if stream else None
            at = at if at is not None else docgfx._moment(entries, raw.get("at") or "", lo, hi)
            at = at if at is not None and at >= 0 else lo + step_s * 0.35
            dur = min(max_s, lengths[sc["type"]])
            at = max(at - 0.15, last_end + 3.0, 0.0)
            if at + dur > min(hi + step_s * 0.5, total - 1.0):
                continue
            sc["duration"] = dur
            placed.append((at, sc))
            last_end = at + dur
    if kit == "pulse":
        keep = []
        for at, sc in placed:
            if sc.get("type") in ("chat", "phone"):
                ans = _chat_answer(engine, job, sc, log)
                if not ans:
                    continue
                words = ans.split()
                cap = 110 if sc.get("type") == "chat" else 60                  # a phone screen holds less
                sc["answer"] = " ".join(words[:cap]) + (" …" if len(words) > cap else "")
                sc["reply"] = sc["answer"]
                if not sc.get("logo"):
                    try:
                        import logos
                        sc["logo"] = logos.data_uri(str(sc.get("company") or sc.get("model") or ""), on="dark")
                    except Exception:                         # noqa: BLE001
                        pass
            keep.append((at, sc))
        placed = keep
    pics = docgfx._pictures(job, total)
    used, kept, tmp = set(), set(), Path(tempfile.mkdtemp(prefix="kit_g_"))
    render_jobs, segs, shown = [], [], []
    # which photos this video already shows is known per run: the app runs job after job in one process, and a run
    # that remembered the one before skipped its own earlier picks (a retry lost its people's photos one by one)
    _seen_faces.pop(str(job), None)
    _alm_seen.pop(str(job), None)
    if kit == "strata":
        # the texts the graphics print are facts (a hardness, an age, a range, a role): checked like the script. The
        # fields that only steer a scene (a DOI to look up, a layout word) are held back from the check
        steer = ("ref", "doi", "style", "view", "entrance", "reveal", "align", "intro", "presentation", "beats",
                 "outro", "morph_from_ma", "age_ma")
        held = [{k_: sc.pop(k_) for k_ in list(sc) if k_ in steer} for _, sc in placed]
        try:
            import factcheck
            factcheck.check_texts(engine, job, [sc for _, sc in placed], style, title)
        except Exception as e:                                    # noqa: BLE001 - a check never costs the video
            log(f"  kits: the graphics' texts were not checked — {str(e)[:120]}")
        finally:
            for (_, sc), h in zip(placed, held):
                sc.update(h)
    if kit == "horizon":
        # the words HORIZON prints are the director's (a quote, a translation, a caption, a source line, a sum, bar
        # names): checked like the script. The series themselves come from the World Bank and the UN, so the fields
        # that only fetch or place them (a country code, an indicator, years, a highlight) are held back
        steer = ("country", "indicator", "hl", "years", "from", "to", "rate", "n", "hot", "add", "key", "mark",
                 "photo", "iw", "ih", "pop", "data", "counts")
        held = [{k_: sc.pop(k_) for k_ in list(sc) if k_ in steer} for _, sc in placed]
        try:
            import factcheck
            factcheck.check_texts(engine, job, [sc for _, sc in placed], style, title)
        except Exception as e:                                    # noqa: BLE001 - a check never costs the video
            log(f"  kits: the graphics' texts were not checked — {str(e)[:120]}")
        finally:
            for (_, sc), h in zip(placed, held):
                sc.update(h)
    if kit == "almanac":
        # the texts the graphics print are checked like the script (factcheck.py): the director writes them after it
        try:
            import factcheck
            factcheck.check_texts(engine, job, [sc for _, sc in placed], style, title)
        except Exception as e:                                    # noqa: BLE001 - a check never costs the video
            log(f"  kits: the graphics' texts were not checked — {str(e)[:120]}")
        # a scene already rendered keeps its photos and its film: they are claimed before any other scene picks one
        # (the reel takes up to 8 clips, and one it picks anew must not be a clip a later, cached scene still plays)
        for k in range(len(placed)):
            for f in mo_dir.glob(f"kit_{k:02d}_*.clips.json"):
                try:
                    old = json.loads(f.read_text(encoding="utf-8"))
                except (OSError, ValueError):
                    continue
                if isinstance(old, dict) and f.with_suffix("").with_suffix(".mp4").exists() and not force:
                    for ph in old.get("photos") or []:
                        if Path(ph).exists():
                            _alm_remember(job, ph)
                    used.update(str(c) for c in old.get("clips") or [])
                    kept.add(f.name[:-len(".clips.json")])            # "kit_00_reel"
    try:
        for k, (at, sc) in enumerate(placed):
            timed = sorted((p for p in pics if p[0] >= 0 and str(p[1]) not in used), key=lambda p: abs(p[0] - at))
            still = [p for p in pics if p[0] < 0 and str(p[1]) not in used]
            pick = (timed or still or [None])[0]
            if kit == "horizon":
                # HORIZON draws its own grounds from real numbers: the series and pyramids are fetched (horizon.py), a
                # quote gets its speaker's photo and a document its picture; a scene that cannot be drawn truthfully
                # is left out. Only the chapter tab sits over the footage around its words.
                import horizon
                if sc["type"] != "tab":
                    pick = None
                horizon.media(engine, job, k, sc, log=log)
                if not horizon.check(sc, log=log):
                    continue
            if kit == "strata":
                # STRATA prints its own grounds (black, charcoal, the teal stage, the map): the real data and pictures
                # are fetched instead — the continents of an age, the paper, a specimen, the team — and the scene
                # gets the narration's word times so its beats land on the words that name them
                import strata
                pick = None
                spoken = " ".join(w for w, _ in strata.word_t(job, at, sc["duration"]))
                strata.enrich(sc, spoken, log=log)
                strata.media(engine, job, k, sc)
                if sc["type"] == "caption" and not (sc.get("photo") or sc.get("object")):
                    # a caption names the object on screen: without its real photo it is a line of text on black,
                    # a title card — the footage under those words plays instead (Robin: "templated")
                    log(f"  kits: the caption at {int(at) // 60}:{int(at) % 60:02d} is left out — no photo of its object")
                    continue
                sc["word_t"] = strata.word_t(job, at, sc["duration"])
            if kit == "almanac":
                # ALMANAC prints its own grounds: its pictures are real cut-outs and the video's own film instead
                pick = None
                if sc["type"] == "reel" and not sc.get("footage") and not _alm_clips(job, pics, at, used, 1) \
                        and f"kit_{k:02d}_reel" not in kept:
                    # no film for the strip: 9.6 s of an empty strip is dead air — the moment becomes a card with the
                    # same title and text, and the footage around it gets the time back. Not a reel already rendered:
                    # the clips claimed above for it are its own, and a resume plays it as it was rendered
                    log(f"  kits: no archive film for the reel at {int(at) // 60}:{int(at) % 60:02d} — it plays as a card")
                    sc["type"] = "card"
                    sc["duration"] = min(sc["duration"], lengths["card"])
                # a scene already rendered takes back the scene it was rendered from (the pictures, the film, the
                # timings the film decided, a hand's cards): no photo is fetched twice and its sounds stay on its beats
                done, saved = mo_dir / f"kit_{k:02d}_{sc['type']}.mp4", None
                if not force and done.exists():
                    try:
                        saved = json.loads(done.with_suffix(".clips.json").read_text(encoding="utf-8"))
                    except (OSError, ValueError):
                        saved = None
                if isinstance(saved, dict) and isinstance(saved.get("scene"), dict):
                    clips = [str(c) for c in saved.get("clips") or []]
                    sc.clear()
                    sc.update(saved["scene"])
                elif isinstance(saved, list):                   # a scene rendered before the scene was kept too
                    clips = [str(c) for c in saved]
                    if sc["type"] == "reel" and not clips:
                        sc["open"] = False
                else:
                    got = _almanac_media(engine, job, k, at, sc, pics, used)
                    if got["drop"]:
                        log(f"  kits: the {sc['type']} at {int(at) // 60}:{int(at) % 60:02d} is left out — fewer than two "
                            f"of its people have a photo")
                        continue
                    clips = got["clips"]
                    done.with_suffix(".clips.json").write_text(json.dumps(
                        {"clips": clips, "photos": got["photos"], "scene": sc}, indent=1, ensure_ascii=False),
                        encoding="utf-8")
                used.update(clips)
                shown += [Path(c).name for c in clips]
            if pick is not None:
                used.add(str(pick[1]))
                blur, bright, sat = _grounds(kit, sc["type"])
                # a real photo of the person for the scenes that show one (chapter, tracker)
                photo_types = (("tracker", "chapter")
                               + (("machine", "record", "quote", "city") if kit == "analog" else ())
                               + (("snap", "namecard", "quote") if kit == "pulse" else ()))
                if sc["type"] in photo_types and (sc.get("subject") or sc.get("query")):
                    try:
                        import photofx
                        who = str(sc.get("subject") or sc.get("name") or "").strip()
                        # one face per video: a second scene about the same person picks
                        # a different picture rather than the one already on screen once
                        seen = _seen_faces.setdefault(str(job), {})
                        photo = photofx.source_photo(engine, who, sc.get("query") or "",
                                                     job / "photofx" / f"kit_{k:02d}")
                        if photo and str(photo) in seen.get(who.lower(), set()):
                            photo = None
                        if photo:
                            seen.setdefault(who.lower(), set()).add(str(photo))
                            pick = (at, Path(photo))
                    except Exception as e:                        # noqa: BLE001
                        log(f"  kits: {sc['type']} keeps a footage ground — {str(e)[:100]}")
                if kit == "analog" and sc["type"] in ("machine", "record", "quote") and str(pick[1]).lower().endswith((".jpg", ".jpeg", ".png", ".webp")) \
                        and "photofx" in str(pick[1]):
                    sc["frame"] = docgfx.ground_uri(pick[1], 0, 1.0, tmp, sat=1.0)      # the photo itself, sharp, in its frame
                sc["ground"] = docgfx.ground_uri(pick[1], blur, bright, tmp, sat=sat)
                if kit == "pulse" and sc["type"] == "quote" and str(pick[1]).lower().endswith((".jpg", ".jpeg", ".png", ".webp")):
                    sc["photo"] = motion.image_data_uri(Path(pick[1]))      # whole: the panel is portrait-shaped
                if kit == "pulse" and sc["type"] == "snap":
                    # The picture is the SHOT, not a ground: sharp and full size. A portrait is
                    # first widened to 16:9 (widen.py paints the sides, the person stays the real
                    # photo) — ground_uri would cover-crop it, cutting the head and leaving the
                    # cutout no longer on top of the person. The cutout is taken from the WIDE
                    # picture, so the white burn also covers the shoulders the model completed.
                    src = Path(pick[1])
                    if src.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp"):
                        try:
                            import widen
                            src = widen.widen(src, job / "photofx" / "wide", log=log)
                        except Exception as e:                    # noqa: BLE001
                            log(f"  kits: snap photo stays as it is — could not widen it ({str(e)[:90]})")
                        sc["photo"] = motion.image_data_uri(src)
                    else:
                        sc["photo"] = docgfx.ground_uri(pick[1], 0, 1.0, tmp, sat=1.0)
                    try:
                        import photofx
                        cut = photofx.cutout(src, job / "photofx" / "cut", log=log)
                        if cut and Path(cut).exists():
                            sc["cut"] = motion.image_data_uri(Path(cut))
                    except Exception as e:                        # noqa: BLE001
                        log(f"  kits: snap has no cutout to burn — {str(e)[:90]}")
                if sc["type"] in ("page", "phones", "player", "timeline", "board", "stamp", "maproom"):
                    # a sharp frame as the "clip" inside the page, and a second, softer one for the ground
                    sc["frame"] = sc["ground"]
                    sc["ground"] = docgfx.ground_uri(pick[1], 9, 0.5, tmp, sat=0.7)
            if kit == "kinetic" and sc["type"] == "bigword" and sc.get("words_big"):
                sc["word_at"] = _spoken_at(job, at, [str(w) for w in sc["words_big"]])
            if kit == "atlas" and sc["type"] == "wave":
                # the picture that follows the wave (the nearest one after it) is what the paint reveals
                after = sorted((p for p in pics if p[0] >= at - 0.3), key=lambda p: p[0])
                if after:
                    sc["frame_next"] = docgfx.ground_uri(after[0][1], 0, 1.0, tmp, sat=1.0)
            sc["seed"] = 11 + k * 7
            out = mo_dir / f"kit_{k:02d}_{sc['type']}.mp4"
            if force:
                out.unlink(missing_ok=True)
            out.with_suffix(".sfx.json").write_text(json.dumps(sound_marks(kit, sc)), encoding="utf-8")
            segs.append((round(at, 2), str(out), sc["duration"]))
            if not out.exists():
                render_jobs.append((sc, out))
        if kit == "almanac":
            # the clips its scenes play: the timeline leaves them out (make_video._kit_footage), so no shot runs twice
            (mo_dir / "kit_footage.json").write_text(json.dumps(sorted(set(shown)), indent=1), encoding="utf-8")
        if render_jobs:
            log(f"kits: rendering {len(render_jobs)} {KITS[kit]['label']} graphics in Chromium...")
            render(kit, render_jobs, workers=max(1, min(3, getattr(engine, "MOTION_WORKERS", 2))), look=look)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    kinds = [Path(p).stem.split("_", 2)[-1] for _, p, _ in segs]
    log(f"kits: {len(segs)} {KITS[kit]['label']} graphics — {', '.join(kinds[:12])}{' ...' if len(kinds) > 12 else ''}")
    return segs


def fix_transitions(engine, plan: list, job: Path, style: str) -> int:
    """Called once the plan is known: every ATLAS paint wave is drawn again over the picture BEFORE it, revealing the
    picture AFTER it — the kit rendered it earlier, before the order of the pictures was decided. Returns the number
    of waves redrawn (a wave already drawn for the same pair is left alone)."""
    import docgfx
    kit = kit_for_style(engine, style)
    if kit != "atlas":
        return 0
    look = (engine.STYLE_INFO.get(style) or {}).get("look") or {}
    try:
        specs = json.loads((job / "motion" / "doc_scenes.json").read_text(encoding="utf-8")).get("items") or []
    except (OSError, ValueError, AttributeError):
        specs = []
    waves = [x for x in specs if isinstance(x, dict) and x.get("type") == "wave"]
    tmp = job / "motion" / "_wave_tmp"
    tmp.mkdir(parents=True, exist_ok=True)
    jobs, t = [], 0.0
    for i, e in enumerate(plan):
        if e[0] == "motion" and "_wave" in str(e[1]):
            nxt = plan[i + 1] if i + 1 < len(plan) else None
            prv = plan[i - 1] if i > 0 else None
            if nxt and nxt[0] == "photo" and Path(str(nxt[1])).exists():
                marker = Path(str(e[1])).with_suffix(".next.json")
                want = {"next": str(nxt[1]), "prev": str(prv[1]) if prv and prv[0] == "photo" else ""}
                try:
                    if json.loads(marker.read_text(encoding="utf-8")) == want and Path(str(e[1])).exists():
                        t += float(e[3])
                        continue
                except (OSError, ValueError):
                    pass
                spec = min(waves, key=lambda x: abs(float(x.get("at_s") or 0) - t)) if waves else {}
                sc = {"type": "wave", "kit": kit, "colour": str(spec.get("colour") or "yellow"), "duration": float(e[3]),
                      "seed": 11 + i * 7, "frame_next": docgfx.ground_uri(Path(str(nxt[1])), 0, 1.0, tmp, sat=1.0)}
                if want["prev"]:
                    sc["ground"] = docgfx.ground_uri(Path(want["prev"]), 0, 1.0, tmp, sat=1.0)
                jobs.append((sc, Path(str(e[1])), marker, want))
        t += float(e[3])
    if jobs:
        engine.log(f"kits: {len(jobs)} paint wave(s) redrawn over the pictures they really join")
        for _, out, _, _ in jobs:
            out.unlink(missing_ok=True)                    # render() keeps an existing clip
        render(kit, [(sc, out) for sc, out, _, _ in jobs], workers=1, look=look)
        for _, out, marker, want in jobs:
            if out.exists():
                marker.write_text(json.dumps(want), encoding="utf-8")
    shutil.rmtree(tmp, ignore_errors=True)
    return len(jobs)


# ── preview / check ──────────────────────────────────────────────────────────────
def samples(kit: str) -> list:
    """One scene of every type, with real-looking content, from the prompt's own examples."""
    out = []
    for line in KITS[kit]["prompt"].splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            raw = json.loads(line)
        except ValueError:
            continue
        sc = _normalise(kit, raw)
        if sc:
            sc["duration"] = KITS[kit]["types"][sc["type"]]
            out.append(sc)
    return out


def _preview(argv: list) -> None:
    import subprocess
    kits = list(KITS) if (argv[:1] or ["all"])[0] == "all" else [argv[0]]
    only = argv[1] if len(argv) > 1 else ""
    ground = HERE / "assets" / "kits" / "preview_ground.jpg"
    out_dir = HERE / "preview" / "kits"
    out_dir.mkdir(parents=True, exist_ok=True)
    import docgfx
    tmp = Path(tempfile.mkdtemp(prefix="kitprev_"))
    for kit in kits:
        if not (KIT_DIR / f"{kit}.js").exists():          # a kit kept on the author's machine (not shipped)
            continue
        jobs = []
        for sc in samples(kit):
            if only and sc["type"] != only:
                continue
            if kit == "strata":                                    # its own grounds; the globe's continents, a paper
                import strata
                strata.enrich(sc)
            if ground.exists() and kit not in ("almanac", "strata") \
                    and not (kit == "horizon" and sc["type"] != "tab"):  # ALMANAC prints its own page and card; HORIZON its navy
                blur, bright, sat = _grounds(kit, sc["type"])
                sc["ground"] = docgfx.ground_uri(ground, blur, bright, tmp, sat=sat)
                if sc["type"] in ("page", "phones", "player", "timeline", "board", "stamp", "maproom"):
                    sc["frame"] = sc["ground"]
                    sc["ground"] = docgfx.ground_uri(ground, 9, 0.5, tmp, sat=0.7)
                if kit == "analog" and sc["type"] in ("machine", "record", "quote"):
                    sc["frame"] = docgfx.ground_uri(ground, 0, 1.0, tmp, sat=1.0)
            out = out_dir / f"{kit}_{sc['type']}.mp4"
            out.unlink(missing_ok=True)
            jobs.append((sc, out))
        if not jobs:
            continue
        t0 = time.time()
        render(kit, jobs, workers=3)
        for sc, out in jobs:
            png = out.with_suffix(".png")
            at = min(float(sc["duration"]) * 0.62, float(sc["duration"]) - 0.4)
            subprocess.run(["ffmpeg", "-y", "-v", "error", "-ss", f"{at:.2f}", "-i", str(out), "-frames:v", "1", str(png)],
                           check=False, capture_output=True)
        print(f"{kit}: {len(jobs)} scene(s) in {time.time() - t0:.0f}s -> {out_dir}")
    shutil.rmtree(tmp, ignore_errors=True)


def _check() -> int:
    """One frame of every type of every kit in Chromium: a JS error here is a scene that would fall out of a video."""
    from playwright.sync_api import sync_playwright
    bad = 0
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=["--disable-gpu"])
        page = browser.new_page(viewport={"width": W, "height": H})
        for kit in KITS:
            if not (KIT_DIR / f"{kit}.js").exists():
                continue
            for sc in samples(kit):
                page.set_content(build_html(kit, sc), wait_until="load")
                try:
                    page.wait_for_function("window.__ready===true", timeout=30000)
                    err = page.evaluate("window.__err||''")
                    for t in (0.0, sc["duration"] * 0.5, sc["duration"] - 0.05):
                        page.evaluate("(t)=>window.renderFrame(t)", t)
                except Exception as e:                            # noqa: BLE001
                    err = str(e)
                if err:
                    bad += 1
                    print(f"FAIL {kit}/{sc['type']}: {err[:200]}")
                else:
                    print(f"ok   {kit}/{sc['type']}")
        browser.close()
    return bad


if __name__ == "__main__":
    if sys.argv[1:2] == ["preview"]:
        _preview(sys.argv[2:])
    elif sys.argv[1:2] == ["check"]:
        sys.exit(1 if _check() else 0)
    else:
        print(__doc__)
