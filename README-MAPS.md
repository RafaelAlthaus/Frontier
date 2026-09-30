# Maps — built into Frontier

Map animations that appear on their own. Whenever the voice names a place that matters
to the story, the video cuts to a map of it: the country, a push in, the place lights up
and lifts off the map while its name writes itself on beside it.

## What it adds

- **Automatic map scenes.** Claude reads the finished narration, picks the moments where a
  map makes the story clearer — where something happened, where someone went, several
  places named together — and each map lands on the exact word that names the place.
- **Nine kinds of map**
  - **Region** — a country, state, province, sea, desert or mountain range lights up and
    lifts out of the map, leaving its hole behind.
  - **Pin** — a city or an exact spot: the pin drops, rings ripple out, a line runs to its name.
  - **Route** — a journey: the line draws from place to place with a ship, a plane or an army
    on it, and arrives on the word that names the destination. Sea voyages go round the coast.
  - **Several places** — each one lights up as it is named. Places too far apart for one view
    (Brazil and Japan) become a flight across the globe.
  - **Zoom** — the satellite dive. For one exact place where the story happens — a palace, a
    base, a camp, a factory, a building, a square, a city — the whole Earth fills the frame,
    the camera dives down to the place on real satellite imagery, tilts into 3D while the
    buildings stand up, the place's real outline draws itself, the rest of the city darkens,
    and its name comes up with a small line above it. At most one every 150 seconds (the
    next one becomes a pin); if the place cannot be found on the map, it gets a pin instead.
  - **Range** — how far something reaches. Rings spread from a place across a 3D globe (or
    across the satellite map when the reach is short), a counter runs up the kilometres, and
    each city the narration names lights up as a ring reaches it; a flight path can arc to the
    target. A missile's range, artillery that can hit a capital, an exclusion zone.
  - **Then & now** — a place before and after. The camera hovers over it on archived satellite
    imagery, a line of light sweeps across and turns the picture into today's, then settles in
    the middle as a before/after split. The years on screen are the pictures' real capture
    dates. The archive starts in 2014.
  - **Night** — night falls over a region: the shadow line crosses the land with the sunset
    glowing along it, the real lights of its cities come on and its borders draw in. North
    Korea dark beside a lit South, the Nile lit through the desert.
  - **Flyover** — a low drone flight over one city on satellite imagery, its real buildings
    standing in 3D, past 2 to 4 landmarks the narration names; each lights up with its name as
    the camera reaches it, and the flight ends hovering over the last. The camera turns like a
    pilot flies: never faster than 30° a second, however the path bends.

  Range, then & now, night and flyover each appear at most once every two minutes. If one cannot be
  made (the archive has one picture of the place, a place is not found), the moment still gets
  a map: a then & now becomes a zoom, the others a region or a pin.
- **Three looks**: `midnight` (dark, glowing teal and green), `paper` (an old atlas: stained
  paper, inked borders, red push pins and string) and `clean` (white land, one strong blue).
  A channel gets the look closest to its graphics unless it names one.
- **Real borders.** Every country, every state and province in the world, 7,300 cities,
  seas, oceans, deserts and mountain ranges, from Natural Earth. Nothing is drawn by an image
  model, so borders are right and the camera can fly from the whole globe down to a single
  state without the picture going soft.
- **Any language.** Place names on screen follow the video's language (Czech videos say
  *Středozemní moře*, not *Mediterranean Sea*).

## Using it

Nothing to set up. Restart the app: **Options → Map animations** is on. Untick it for a
video that should have none.

A map scene takes the place of a regular motion graphic that would have played at the same
moment, so a video does not end up with more graphics than before — just the right ones.

To see the maps without making a video:

    python maps.py demo                              # six sample scenes into preview/
    python maps.py show "Texas"                      # one place
    python maps.py show "London > New York" --icon plane
    python maps.py show "Japan" --skin paper
    python maps.py check                             # every map type in every look, errors reported

## Per channel

In a channel's style file, under `look`:

    "maps": {
      "skin": "paper",        // midnight | paper | clean
      "every_s": 35,          // at most one map per this many seconds of video, on average
      "gap_s": 15,            // never two maps closer than this
      "colors": {"hi": "#E8A33D", "hiLight": "#F2BE62", "hiDark": "#B97F22"}
    }

`"maps": false` turns maps off for that channel altogether. Every key is optional.

The satellite zoom has three keys of its own in the same place:

    "maps": {
      "zoom": true,             // false: no satellite dives, pins instead
      "zoom_every_s": 150,      // never two dives closer than this
      "zoom_accent": "#FFC400", // the outline, the lit building, the dot and the name
      "fx": true,               // false: no range, then & now or night
      "fx_every_s": 120         // never the same one of those twice within this
    }

## Satellite zoom — where it comes from

- **Imagery**: Esri World Imagery tiles. Its credit line — *Imagery © Esri, Maxar, Earthstar
  Geographics · Buildings © OpenStreetMap* — is drawn in the corner of every zoom; keep it.
  Satellite imagery belongs to its provider: check that its terms fit how you publish. Another
  XYZ imagery source can be set with `SATZOOM_TILES` (a URL with `{z}`, `{x}`, `{y}`) and its
  credit with `SATZOOM_CREDIT`, both in `.env`.
- **The place and its outline**: OpenStreetMap through Nominatim. The grounds are outlined; a
  building of the same name (Apple Park's ring, the Kumsusan palace) is the one lit up.
- **The 3D buildings**: OpenStreetMap footprints and heights through Overpass.
- **Then & now**: Esri World Imagery Wayback, the archive of every World Imagery release since
  2014; the capture dates come from each release's metadata.
- **Night**: NASA Earth Observatory's Black Marble 2016 (VIIRS), public domain, through NASA
  GIBS. Borders from the maps' own Natural Earth data.
- No API key, no cost. Everything is cached in `~/.frontier/satzoom/` (a zoom downloads about
  30–60 MB of tiles the first time); a scene renders in under a minute, in Python, without a
  browser or a graphics card.

To see one without making a video:

    python satzoom.py show "Kumsusan Palace of the Sun" --city Pyongyang --country "North Korea" --title "Kumsusan Palace" --kicker "the Kim family mausoleum"
    python satzoom.py frames "Apple Park" --city Cupertino --t 1.5 3.2 4.5 6.4     # stills, faster
    python satfx.py range "Pyongyang" --km 1300 4500 --targets Tokyo Guam --arcs --title "Hwasong-12" --kicker "a range of 4,500 km"
    python satfx.py then_now "Ryomyong Street" --city Pyongyang --country "North Korea" --then 2015 --title "Ryomyong Street"
    python satfx.py night "Korea" --lat 37.9 --lon 127.6 --labels Pyongyang Seoul --borders "North Korea" "South Korea" --title "Korea at night"
    python satfx.py flyover "Pyongyang" --country "North Korea" --waypoints "Kim Il Sung Square" "Juche Tower" "Ryugyong Hotel" --title "Pyongyang"
    (satfx.py takes --frames 1.0 4.0 7.5 for stills)

## Cost

The maps themselves cost nothing: no image model, no API. Each video makes one extra Claude
call to find the places (through Claude Code, like the script), and each map takes about
25 seconds to render.

## Limits worth knowing

- Borders are today's, in Natural Earth's default view. A historical empire is drawn as the
  modern countries it covered, merged into one shape.
- A village too small for the atlas becomes a pin at the coordinates Claude gives.
- A map never lands inside the video's opening caption.

## For Claude Code

- `maps.py` — everything: place lookup (`resolve`), the moment finder (`MOMENTS_PROMPT`,
  `plan_moments`), timing to the word (`build_scenes`), the scene builders (`_region`, `_pin`,
  `_route`, `_multi`), the skins (`SKINS`), the Chromium renderer (`render`) and the hook
  the engine calls (`add_to_timeline`). Constants at the top of the TIMELINE section set
  durations and spacing.
- `satzoom.py` — the satellite zoom: place lookup (`find`: Nominatim outline, Overpass buildings),
  the camera (`camera`, `View`; the dive follows `ZOOM_CURVE`, measured frame by frame on the
  reference edit), the ground renderer (each pixel read from the tile level that matches its size),
  the 3D buildings, the lettering (`Text`) and `render`. `maps.build_scenes` hands it moments with
  shot "zoom" (`_zoom_scene`), `add_to_timeline` renders them as `map_NN.mp4` with a
  `map_NN.sfx.json` of sound marks beside it.
- `satfx.py` — range, then & now, night and flyover on the same engine: `range_scene`, `then_now_scene`,
  `night_scene`, `flyover_scene` build a scene (the lookups: geocoding, the Wayback releases and capture dates, the
  borders), `RangeShot` / `ThenNowShot` / `NightShot` draw it, `render` writes the mp4 and its sound
  marks. Rings are painted per pixel by distance from the origin, so they are exact on the globe.
  `maps.build_scenes` hands over shots "range", "then_now", "night", "flyover" (`_fx_scene`).
  The 3D blocks are `satzoom.Blocks`, shared by the zoom and the flyover.
- `assets/maps/map.js` — the page every map is drawn on. Same rule as every Frontier
  animation: `window.renderFrame(t)` draws frame t from t alone. Shots live in `SHOTS`.
- `assets/maps/*.json` — the atlas (TopoJSON at three levels of detail, plus `gazetteer.json`
  with every name). Built from Natural Earth; there is no need to rebuild it.
- The engine side is small and dormant: `_with_scene_dlcs()` in make_video.py runs `maps.py`
  (right after the opening caption is placed), and the `maps` option in app.py / ui.html.
- Per video: `output/<video>/maps/moments.json` is what Claude picked (delete it to ask
  again), `map_NN.mp4` the rendered scenes.
- To change a look: edit its entry in `SKINS`, then `python maps.py check` and open
  `preview/_maps_check.png` with your Read tool before saying it is done.
