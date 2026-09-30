#!/usr/bin/env python3
"""Build the AI-avatar preset library: 10 hyper-real UGC portraits via gpt-image-2.

The look is six layers, learned from real viral AI-avatar channels:
  1 ordinary non-model face, visible skin texture      5 caught mid-sentence
  2 a specific lived-in room that belongs to them      6 consumer-phone capture
  3 one soft window light source                       + explicit anti-studio negatives
  4 chest-up framing from a propped-up phone

Only PERSONA and ROOM change per avatar; layers 3-6 are shared, which is what
keeps the whole library looking like one format instead of ten stock photos.
"""
import json, os, sys, time
from pathlib import Path
import requests

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
for line in (ROOT / ".env").read_text().splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip())

BASE = os.environ.get("ALGROW_BASE", "https://api.algrow.online")
HDR = {"Authorization": f"Bearer {os.environ['ALGROW_API_KEY']}", "Content-Type": "application/json"}

# The light depends on the place — a window for a kitchen, the overhead rig for a gym, a
# monitor and LED strips for a streamer, the sun on a trail — so it is its own layer: the
# window below is the default, and an entry can name its own as a sixth field.
DEFAULT_LIGHT = "Soft daylight from a window to one side, slightly blown out, warm bounce off the room; no other lighting."

SHARED = (
 "Chest-up medium close-up, head with room above it, eyes on the upper third, camera at eye level on a "
 "propped-up phone, mild wide-angle distortion, background clearly readable and only slightly soft. "
 "Caught mid-sentence: mouth open, eyebrows slightly raised, looking straight into the lens. "
 "Captured on a consumer phone camera: mild sensor noise in the shadows, slight over-sharpening, "
 "a touch of auto-white-balance warmth, soft video-codec detail. "
 "An unedited frame grab from a real person's YouTube video. "
 "NOT studio lighting, NOT a softbox, NOT a seamless backdrop, NOT heavy bokeh, NOT cinematic colour grading, "
 "NOT retouched skin, NOT a stock photo, NOT a professional headshot, NOT a model. "
 # Offices, libraries, clinics and gear desks are full of words; an image model misspells
 # every one of them, and warped hands are the other giveaway — both are kept out.
 "No readable text, letters, numbers, logos or brand names anywhere in the frame — screens, book "
 "spines, labels, badges and posters are blurred or blank. Hands relaxed and mostly out of frame."
)

AVATARS = [
 # id, gender, niches, persona, room
 ("maria",  "female", ["cooking","home","family"],
  "A 62-year-old Mexican-American woman, curly grey hair, reading glasses pushed up on her head, small gold hoop "
  "earrings, deep laugh lines and visible pores, wearing a faded rose t-shirt",
  "a small lived-in Mexican home kitchen: orange wall, blue-and-white tiled counter, a stone molcajete, a comal on "
  "the stove, a dish rack still full, a paper-towel roll, a bowl of tomatoes, a round blue wall clock"),
 ("eleanor","female", ["cooking","baking","homemaking"],
  "A 71-year-old white woman, white hair in a loose bun, freckled and sun-spotted skin, deep crow's feet, wearing a "
  "sage-green linen shirt under a cream apron, hands resting on the counter",
  "a bright modern kitchen with pale oak cabinets, white tile backsplash, a bowl of lemons, a crock of wooden spoons, "
  "a stainless fridge, a striped towel on the oven handle"),
 ("denise", "female", ["finance","career","retirement"],
  "A 54-year-old Black woman, short natural greying hair, reading glasses low on her nose, laugh lines, wearing a "
  "plain navy cardigan over a grey top",
  "a cluttered home office: a crowded bookshelf, a desk lamp, stacked paper files, a mug, a small potted plant, "
  "a framed family photo, beige wall"),
 ("priya",  "female", ["health","wellness","habits"],
  "A 46-year-old South Asian woman, dark hair loosely tied back with strands loose, a small nose stud, tired but "
  "warm eyes, visible skin texture, wearing a plain mustard t-shirt",
  "a sunlit lived-in living room: a worn linen sofa, several trailing houseplants, a stack of books on the floor, "
  "a woven basket, a half-drunk cup of tea on a side table"),
 ("ruth",   "female", ["garden","homestead","frugal"],
  "A 66-year-old white woman, short grey windblown hair, weathered sun-damaged skin, no makeup, wearing a faded "
  "denim shirt with rolled sleeves and dirt on the cuffs",
  "a cluttered potting shed / greenhouse: seed trays, terracotta pots, a coiled hose, hand tools on hooks, "
  "condensation on the glass, bags of compost"),
 ("walter", "male", ["finance","retirement","seniors"],
  "A 68-year-old white man, thinning grey hair, deep forehead lines, grey stubble, reading glasses pushed up on his "
  "head, sun-damaged uneven skin, wearing a plain faded navy polo",
  "a modest American suburban kitchen: honey-oak cabinets, a white fridge covered in magnets and a child's drawing, "
  "a dish rack with plates in it, a paper-towel roll, a fruit bowl, a plaid curtain over the window"),
 ("marcus", "male", ["bbq","food","craft"],
  "A 61-year-old Black man, short greying beard, a navy ball cap, deep smile lines, working hands, wearing a worn "
  "navy work shirt over a white tee",
  "an open barbecue shed: a big black steel smoker, neatly stacked split firewood, long-handled tools on the wall, "
  "daylight flooding in from the open side"),
 ("dale",   "male", ["prepper","outdoors","survival"],
  "A 52-year-old white man, greying beard, camouflage ball cap, weathered skin, direct stare, wearing a camo jacket "
  "over a black tee",
  "a log-cabin den: stone fireplace, a US flag on the timber wall, a dark leather armchair, a lantern on the mantel, "
  "antlers above the door"),
 ("javier", "male", ["cars","diy","trades"],
  "A 45-year-old Hispanic man, close-cropped black hair going grey at the temples, a few days of stubble, a smear of "
  "grease on one forearm, wearing a grey work shirt with the sleeves pushed up",
  "a home garage workbench: sockets laid out on a pegboard, an open toolbox, a battered work light, oil stains on "
  "the concrete, a car half-visible behind him"),
 ("kenji",  "male", ["tech","diy","repair"],
  "A 55-year-old East Asian man, greying hair, thin wire-framed glasses, calm expression, visible skin texture, "
  "wearing a plain charcoal t-shirt",
  "a cluttered electronics workshop desk: a soldering iron in its stand, spools of wire, an opened-up laptop, "
  "a desk lamp throwing hard shadows, shelves of labelled parts boxes"),
 # ── 2026-09-21: younger faces in the professional places other niches trust ──
 ("amara",  "female", ["finance","business","investing","career"],
  "A 31-year-old Black woman of Nigerian-British descent, shoulder-length box braids pulled back, small gold "
  "stud earrings, warm brown skin with visible texture and a few freckles across her nose, wearing a charcoal "
  "blazer over a plain white t-shirt",
  "a small glass-walled office in a shared workspace: a laptop and a notebook on a plain desk, a pot plant, a "
  "wiped whiteboard with faint smudges behind her, city buildings soft through the window",
  "Daylight from the office window to one side, cool and even, with a little warm light from a desk lamp."),
 ("lina",   "female", ["health","medical","nursing","wellness"],
  "A 29-year-old Filipina woman, straight black hair in a low ponytail, no makeup, tired but kind eyes, visible "
  "skin texture, wearing teal medical scrubs with a stethoscope around her neck",
  "a small clinic examination room: a paper-covered exam bed, a blood-pressure cuff on the wall, a box of "
  "gloves on the counter, a sink with a pump bottle, pale green walls",
  "Flat overhead clinic lighting mixed with daylight from a frosted window, slightly cool, true to a real clinic."),
 ("freya",  "female", ["fitness","nutrition","health","habits"],
  "A 26-year-old white Scandinavian woman, strawberry-blonde hair in a high ponytail with loose strands, "
  "flushed cheeks and a light sheen of sweat, freckles, visible skin texture, wearing a plain grey athletic t-shirt",
  "standing on the floor of a real neighbourhood gym: squat racks, a row of dumbbells on a rack, rubber floor "
  "mats, a chalk-dusted pull-up bar, a water bottle on a bench",
  "The gym's own overhead lighting, a little harsh, with daylight from high windows."),
 ("nadia",  "female", ["history","science","education","explainer"],
  "A 38-year-old Lebanese woman, dark wavy shoulder-length hair tucked behind one ear, thin gold-rimmed "
  "glasses, a few fine lines around the eyes, visible skin texture, wearing a rust-coloured knit sweater",
  "a quiet corner of an old public library: tall wooden shelves of books behind her, a reading table with an "
  "open atlas and a stack of books, a green banker's lamp",
  "Warm light from the banker's lamp and soft daylight from a tall window."),
 ("arjun",  "male", ["tech","gadgets","reviews","ai"],
  "A 32-year-old Indian man, short neat black hair, a trimmed beard, dark eyes, visible skin texture, wearing "
  "a plain olive-green crew-neck t-shirt",
  "a home desk set up for reviewing gadgets: two phones and a small camera on the desk, a mechanical "
  "keyboard, a desk microphone on an arm at the edge of frame, a monitor glowing behind him, a pegboard of cables",
  "A small soft desk light in front of him and the cool glow of the monitor behind him."),
 ("tunde",  "male", ["food","cooking","recipes","restaurant"],
  "A 36-year-old Nigerian man, very short black hair, a neat full beard, broad shoulders, visible skin "
  "texture, wearing white chef's whites with the sleeves pushed up and a kitchen towel over one shoulder",
  "standing in a working restaurant kitchen after service: stainless-steel counters, hanging pans, a stack of "
  "clean plates, a pass with heat lamps, a white tiled wall",
  "Bright overhead kitchen lights and the warm glow of the heat lamps."),
 ("jun",    "male", ["gaming","esports","internet","tech"],
  "A 23-year-old Korean-American man, black hair with a grown-out fade and a fringe, a thin silver chain, "
  "visible skin texture and a couple of blemishes, wearing a black hoodie with over-ear headphones around his neck",
  "his bedroom streaming setup: a gaming chair, a desk with a keyboard and mouse, soft purple and blue LED "
  "strips on the wall behind him, a shelf of small figurines, the corner of an unmade bed",
  "The purple and blue LED strips behind him and the glow of his monitor on his face, with a little warm "
  "light from a desk lamp."),
 ("liam",   "male", ["travel","outdoors","adventure","geography"],
  "A 34-year-old white Australian man, sun-bleached messy light-brown hair, stubble, a sunburnt nose, squint "
  "lines from the sun, visible skin texture, wearing a faded red hiking shirt with a backpack strap over one shoulder",
  "standing on a mountain trail: a rocky path, low scrubby bushes, a wide valley and distant ridges behind "
  "him under a few clouds",
  "Bright natural daylight outdoors, slightly hazy, the sun to one side."),
]


def prompt_for(persona: str, room: str, light: str = "") -> str:
    # "sitting in a kitchen" reads wrong for a trail or a gym floor, so an entry may start
    # its place with its own verb; the older entries keep the sentence they were drawn with.
    where = room if room.split(" ", 1)[0] in ("sitting", "standing", "leaning", "kneeling") else f"sitting in {room}"
    return (f"Amateur smartphone video still, front-facing talking-head frame. {persona}. "
            f"They are {where}. {light or DEFAULT_LIGHT} {SHARED}")


def generate(prompt: str) -> str:
    r = requests.post(f"{BASE}/api/generate-image", headers=HDR,
                      json={"prompt": prompt[:5000], "model": "gpt-image-2", "aspect_ratio": "16:9"}, timeout=90)
    r.raise_for_status()
    d = r.json()
    job = d.get("job_id") or (d.get("data") or {}).get("job_id")
    if not job:
        raise RuntimeError(f"no job_id: {str(d)[:200]}")
    t0 = time.time()
    while time.time() - t0 < 600:
        s = requests.get(f"{BASE}/api/job-status/{job}", headers=HDR, timeout=45).json()
        st = (s.get("status") or "").lower()
        if st in ("completed", "succeeded", "success"):
            urls = s.get("image_urls") or (s.get("result") or {}).get("image_urls") or []
            if not urls:
                raise RuntimeError(f"done but no image_urls: {str(s)[:200]}")
            return urls[0]
        if st in ("failed", "error"):
            raise RuntimeError(f"job {st}: {str(s.get('error') or s)[:160]}")
        time.sleep(4)
    raise TimeoutError("algrow job timed out")


if __name__ == "__main__":
    only = sys.argv[1:] or None
    manifest = []
    mf = HERE / "avatars.json"
    if mf.exists():
        manifest = json.loads(mf.read_text())
    done = {a["id"] for a in manifest}
    for entry in AVATARS:
        aid, gender, niches, persona, room = entry[:5]
        light = entry[5] if len(entry) > 5 else ""
        if aid in done or (only and aid not in only):
            continue
        p = prompt_for(persona, room, light)
        print(f"[{aid}] generuju…", flush=True)
        try:
            url = generate(p)
        except Exception as e:
            print(f"  ! {aid}: {str(e)[:180]}", flush=True)
            continue
        dest = HERE / f"{aid}.png"
        dest.write_bytes(requests.get(url, timeout=180).content)
        manifest.append({"id": aid, "gender": gender, "niches": niches,
                         "file": dest.name, "persona": persona, "room": room})
        mf.write_text(json.dumps(manifest, indent=2, ensure_ascii=False))
        print(f"  -> {dest.name}", flush=True)
    print(f"\nhotovo: {len(manifest)}/{len(AVATARS)} avataru v {mf}")
