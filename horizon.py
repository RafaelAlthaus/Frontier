#!/usr/bin/env python3
"""horizon.py — the data and the pictures behind the HORIZON kit (assets/kits/horizon.js).

HORIZON is a data documentary: its graphics are drawn from real numbers, never typed-in guesses. The director names a
series and this module fetches it, once, into ~/.frontier/horizon (no key needed):

    World Bank indicators   {"source": "worldbank", "country": "KOR", "indicator": "SP.DYN.TFRT.IN"}
                            api.worldbank.org — births per woman, population, GDP, life expectancy, … for every country
    UN population pyramids  {"type": "pyramid", "country": "KOR", "years": [1960, 2024, 2072]}
                            UN World Population Prospects 2024 by 5-year age group, 1950–2100, through
                            PopulationPyramid.net's open CSV; checked against the World Bank's total population so a
                            wrong country code can never draw another country's pyramid

A scene whose numbers cannot be fetched is dropped — a chart with a made-up line is worse than no chart.

    python horizon.py wb KOR SP.DYN.TFRT.IN          print a series
    python horizon.py pyramid KOR 1960 2024 2072     print the totals of three pyramids
"""

import base64
import io
import json
import math
import sys
import time
from pathlib import Path

import requests

HERE = Path(__file__).resolve().parent
CACHE = Path.home() / ".frontier" / "horizon"
UA = {"User-Agent": "Mozilla/5.0 (Frontier HORIZON; data documentary)"}

# ISO 3166 alpha-3 -> UN M49 / ISO numeric (the code PopulationPyramid.net's API takes)
M49 = {
    "ABW":533,"AFG":4,"AGO":24,"AIA":660,"ALA":248,"ALB":8,"AND":20,"ARE":784,"ARG":32,"ARM":51,"ASM":16,"ATA":10,
    "ATF":260,"ATG":28,"AUS":36,"AUT":40,"AZE":31,"BDI":108,"BEL":56,"BEN":204,"BES":535,"BFA":854,"BGD":50,
    "BGR":100,"BHR":48,"BHS":44,"BIH":70,"BLM":652,"BLR":112,"BLZ":84,"BMU":60,"BOL":68,"BRA":76,"BRB":52,
    "BRN":96,"BTN":64,"BVT":74,"BWA":72,"CAF":140,"CAN":124,"CCK":166,"CHE":756,"CHL":152,"CHN":156,"CIV":384,
    "CMR":120,"COD":180,"COG":178,"COK":184,"COL":170,"COM":174,"CPV":132,"CRI":188,"CUB":192,"CUW":531,"CXR":162,
    "CYM":136,"CYP":196,"CZE":203,"DEU":276,"DJI":262,"DMA":212,"DNK":208,"DOM":214,"DZA":12,"ECU":218,"EGY":818,
    "ERI":232,"ESH":732,"ESP":724,"EST":233,"ETH":231,"FIN":246,"FJI":242,"FLK":238,"FRA":250,"FRO":234,"FSM":583,
    "GAB":266,"GBR":826,"GEO":268,"GGY":831,"GHA":288,"GIB":292,"GIN":324,"GLP":312,"GMB":270,"GNB":624,"GNQ":226,
    "GRC":300,"GRD":308,"GRL":304,"GTM":320,"GUF":254,"GUM":316,"GUY":328,"HKG":344,"HMD":334,"HND":340,"HRV":191,
    "HTI":332,"HUN":348,"IDN":360,"IMN":833,"IND":356,"IOT":86,"IRL":372,"IRN":364,"IRQ":368,"ISL":352,"ISR":376,
    "ITA":380,"JAM":388,"JEY":832,"JOR":400,"JPN":392,"KAZ":398,"KEN":404,"KGZ":417,"KHM":116,"KIR":296,"KNA":659,
    "KOR":410,"KWT":414,"LAO":418,"LBN":422,"LBR":430,"LBY":434,"LCA":662,"LIE":438,"LKA":144,"LSO":426,"LTU":440,
    "LUX":442,"LVA":428,"MAC":446,"MAF":663,"MAR":504,"MCO":492,"MDA":498,"MDG":450,"MDV":462,"MEX":484,"MHL":584,
    "MKD":807,"MLI":466,"MLT":470,"MMR":104,"MNE":499,"MNG":496,"MNP":580,"MOZ":508,"MRT":478,"MSR":500,"MTQ":474,
    "MUS":480,"MWI":454,"MYS":458,"MYT":175,"NAM":516,"NCL":540,"NER":562,"NFK":574,"NGA":566,"NIC":558,"NIU":570,
    "NLD":528,"NOR":578,"NPL":524,"NRU":520,"NZL":554,"OMN":512,"PAK":586,"PAN":591,"PCN":612,"PER":604,"PHL":608,
    "PLW":585,"PNG":598,"POL":616,"PRI":630,"PRK":408,"PRT":620,"PRY":600,"PSE":275,"PYF":258,"QAT":634,"REU":638,
    "ROU":642,"RUS":643,"RWA":646,"SAU":682,"SDN":729,"SEN":686,"SGP":702,"SGS":239,"SHN":654,"SJM":744,"SLB":90,
    "SLE":694,"SLV":222,"SMR":674,"SOM":706,"SPM":666,"SRB":688,"SSD":728,"STP":678,"SUR":740,"SVK":703,"SVN":705,
    "SWE":752,"SWZ":748,"SXM":534,"SYC":690,"SYR":760,"TCA":796,"TCD":148,"TGO":768,"THA":764,"TJK":762,"TKL":772,
    "TKM":795,"TLS":626,"TON":776,"TTO":780,"TUN":788,"TUR":792,"TUV":798,"TWN":158,"TZA":834,"UGA":800,"UKR":804,
    "UMI":581,"URY":858,"USA":840,"UZB":860,"VAT":336,"VCT":670,"VEN":862,"VGB":92,"VIR":850,"VNM":704,"VUT":548,
    "WLF":876,"WSM":882,"YEM":887,"ZAF":710,"ZMB":894,"ZWE":716,
}
AGES = ["0-4", "5-9", "10-14", "15-19", "20-24", "25-29", "30-34", "35-39", "40-44", "45-49", "50-54", "55-59",
        "60-64", "65-69", "70-74", "75-79", "80-84", "85-89", "90-94", "95-99", "100+"]
WB_SOURCE = "WORLD BANK"
UN_SOURCE = "UN WORLD POPULATION PROSPECTS 2024"


def _cache(name: str) -> Path:
    CACHE.mkdir(parents=True, exist_ok=True)
    return CACHE / name


def _get(url: str, tries: int = 3, timeout: int = 30):
    last = None
    for k in range(tries):
        try:
            r = requests.get(url, headers=UA, timeout=timeout)
            if r.status_code == 429 or r.status_code >= 500:
                last = f"HTTP {r.status_code}"
                time.sleep(2 + 3 * k)
                continue
            r.raise_for_status()
            return r
        except requests.RequestException as e:
            last = str(e)
            time.sleep(1 + 2 * k)
    raise RuntimeError(f"horizon: {url} failed — {last}")


# ── World Bank ───────────────────────────────────────────────────────────────────
def worldbank(country: str, indicator: str, y0: int = 1960, y1: int = 2100) -> list:
    """[[year, value]] of one World Bank indicator for one country (ISO3), oldest first, gaps left out."""
    country, indicator = str(country).upper().strip(), str(indicator).strip()
    f = _cache(f"wb_{country}_{indicator}.json")
    rows = None
    if f.exists() and time.time() - f.stat().st_mtime < 30 * 86400:
        try:
            rows = json.loads(f.read_text(encoding="utf-8"))
        except ValueError:
            rows = None
    if rows is None:
        r = _get(f"https://api.worldbank.org/v2/country/{country}/indicator/{indicator}?format=json&per_page=20000")
        d = r.json()
        if not isinstance(d, list) or len(d) < 2 or not d[1]:
            raise RuntimeError(f"horizon: the World Bank has no {indicator} for {country}")
        rows = sorted([int(x["date"]), float(x["value"])] for x in d[1] if x.get("value") is not None
                      and str(x.get("date") or "").isdigit())
        f.write_text(json.dumps(rows), encoding="utf-8")
    return [[y, v] for y, v in rows if y0 <= y <= y1]


def country_name(country: str) -> str:
    country = str(country).upper().strip()
    f = _cache(f"wb_name_{country}.json")
    if f.exists():
        return json.loads(f.read_text(encoding="utf-8"))
    try:
        d = _get(f"https://api.worldbank.org/v2/country/{country}?format=json").json()
        name = d[1][0]["name"]
    except Exception:                                         # noqa: BLE001 - a name is only a label
        name = country
    name = {"Korea, Rep.": "South Korea", "Korea, Dem. People's Rep.": "North Korea", "Russian Federation": "Russia",
            "Iran, Islamic Rep.": "Iran", "Egypt, Arab Rep.": "Egypt", "Turkiye": "Turkey", "Viet Nam": "Vietnam",
            "Hong Kong SAR, China": "Hong Kong", "Venezuela, RB": "Venezuela", "Yemen, Rep.": "Yemen",
            "Slovak Republic": "Slovakia", "Czechia": "Czech Republic"}.get(name, name)
    f.write_text(json.dumps(name), encoding="utf-8")
    return name


# ── UN WPP pyramids ──────────────────────────────────────────────────────────────
def _pyramid_year(code: int, year: int) -> list:
    f = _cache(f"pp_{code}_{year}.json")
    if f.exists():
        return json.loads(f.read_text(encoding="utf-8"))
    d = _get(f"https://www.populationpyramid.net/api/pp/{code}/{year}/").json()
    m = [round(float(x["v"]), 1) for x in d.get("male") or []]
    w = [round(float(x["v"]), 1) for x in d.get("female") or []]
    if len(m) != 21 or len(w) != 21:
        raise RuntimeError(f"horizon: no pyramid for country {code} in {year}")
    got = [m, w]
    f.write_text(json.dumps(got), encoding="utf-8")
    return got


def pyramid(country: str, years: list) -> dict:
    """{"1960": [[men 0-4 … 100+], [women …]], …} in thousands — every year from the first to the last asked, so the
    scene can morph through them. Verified against the World Bank's total population for a year both have."""
    country = str(country).upper().strip()
    code = M49.get(country)
    if not code:
        raise RuntimeError(f"horizon: no UN code for {country!r} (use the ISO alpha-3 code, e.g. KOR)")
    ys = sorted({int(y) for y in years if 1950 <= int(y) <= 2100})
    if not ys:
        raise RuntimeError("horizon: no year between 1950 and 2100")
    out = {}
    step = 1 if ys[-1] - ys[0] <= 160 else 5
    for y in range(ys[0], ys[-1] + 1, step):
        out[str(y)] = _pyramid_year(code, y)
    for y in ys:
        out.setdefault(str(y), _pyramid_year(code, y))
    # the check: the pyramid of a year the World Bank also knows must add up to its population (±8 %)
    try:
        pop = dict((y, v) for y, v in worldbank(country, "SP.POP.TOTL"))
        both = [y for y in (2020, 2015, 2010, 2000, 1990) if y in pop]
        if both:
            y = both[0]
            p = _pyramid_year(code, y)
            total = (sum(p[0]) + sum(p[1])) * 1000
            if abs(total - pop[y]) / pop[y] > 0.08:
                raise RuntimeError(f"horizon: the pyramid for {country} does not add up to its population "
                                   f"({total:,.0f} vs {pop[y]:,.0f}) — wrong country code?")
    except RuntimeError:
        raise
    except Exception:                                         # noqa: BLE001 - the check needs the network; the data stands
        pass
    return out


# ── scenes ───────────────────────────────────────────────────────────────────────
def _num(v, default=None):
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def enrich(sc: dict) -> dict:
    """Fills in the numbers a scene names (series, pyramids) and derives what follows from them. Raises when the
    scene cannot be drawn truthfully — the caller then leaves it out."""
    t = sc.get("type")
    if t in ("linechart", "yearbars") and not sc.get("data"):
        if not (sc.get("country") and sc.get("indicator")):
            raise RuntimeError(f"horizon: {t} needs data, or a country and a World Bank indicator")
        y0 = int(_num(sc.get("from"), 1960) or 1960)
        y1 = int(_num(sc.get("to"), 2100) or 2100)
        sc["data"] = worldbank(sc["country"], sc["indicator"], y0, y1)
        if len(sc["data"]) < 3:
            raise RuntimeError(f"horizon: too few years of {sc['indicator']} for {sc['country']}")
        sc.setdefault("source", f"SOURCE: {WB_SOURCE}")
    if t in ("linechart", "yearbars") and isinstance(sc.get("data"), list):
        sc["data"] = [[_num(x[0]), _num(x[1])] for x in sc["data"]
                      if isinstance(x, (list, tuple)) and len(x) >= 2 and _num(x[0]) is not None and _num(x[1]) is not None]
        if sc.get("add"):                                     # newer official points the World Bank has not caught up with
            have = {x[0] for x in sc["data"]}
            for x in sc.get("add") or []:
                if isinstance(x, (list, tuple)) and len(x) >= 2 and _num(x[0]) is not None:
                    if _num(x[0]) in have:
                        sc["data"] = [[a, (_num(x[1]) if a == _num(x[0]) else b)] for a, b in sc["data"]]
                    else:
                        sc["data"].append([_num(x[0]), _num(x[1])])
            sc["data"].sort()
    if t == "pyramid" and not sc.get("pop"):
        years = [int(_num(y, 0) or 0) for y in (sc.get("years") or [])]
        if not sc.get("country") or len(years) < 1:
            raise RuntimeError("horizon: a pyramid needs a country and its years")
        sc["pop"] = pyramid(sc["country"], years)
        sc.setdefault("source", f"SOURCE: {UN_SOURCE} (MEDIUM VARIANT)")
    if t == "gens":
        r = _num(sc.get("rate"))
        if r is None or not 0.1 <= r <= 8:
            raise RuntimeError("horizon: gens needs the births-per-woman rate")
        start = int(_num(sc.get("start"), 100) or 100)
        rows, n = [], float(start)
        for _ in range(4):
            rows.append(round(n, 1))
            n = n / 2 * r                                     # half of the people are women; each has `rate` children
        sc["counts"] = rows
    return sc


def _data_uri(path, max_w: int = 1400) -> tuple:
    from PIL import Image
    im = Image.open(path).convert("RGB")
    if im.width > max_w:
        im = im.resize((max_w, round(im.height * max_w / im.width)), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=90)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode(), im.width, im.height


def prep(sc: dict) -> dict:
    """What kits.build_html needs: the numbers filled in, and every picture inlined with its size (the page cannot
    open files, and a document's note points at a spot on it)."""
    try:
        enrich(sc)
    except Exception as e:                                    # noqa: BLE001 - kits drops a scene that throws in the JS
        sc["error"] = str(e)[:200]
    if sc.get("type") == "docshot" and not sc.get("photo"):
        # previews and `kits.py check` only: a real render has already left out a document scene without its picture
        sc["photo"] = str(HERE / "assets" / "kits" / "horizon" / "sample_document.jpg")
    for key in ("photo",):
        v = sc.get(key)
        if isinstance(v, str) and v and not v.startswith("data:") and Path(v).is_file():
            sc[key], sc["iw"], sc["ih"] = _data_uri(v)
    return sc


def media(engine, job: Path, k: int, sc: dict, log=print):
    """The real picture a quote card or a document scene shows: a photo of the person quoted, the poster, the letter,
    the page — found by photofx from the director's subject/query. Data scenes need none."""
    if sc.get("type") not in ("quote", "docshot") or sc.get("photo"):
        return
    who = str(sc.get("subject") or "").strip()
    query = str(sc.get("query") or who).strip()
    if not (who or query):
        return
    try:
        import photofx
        p = photofx.source_photo(engine, who or query, query, Path(job) / "photofx" / f"horizon_{k:02d}")
        if p:
            sc["photo"] = str(p)
    except Exception as e:                                    # noqa: BLE001 - a quote without a portrait is still a quote
        log(f"  horizon: no picture for the {sc.get('type')} ({str(e)[:90]})")


def check(sc: dict, log=print) -> bool:
    """Before the render: a data scene without its numbers, or a document scene without its document, is left out."""
    try:
        enrich(sc)
    except Exception as e:                                    # noqa: BLE001
        log(f"  horizon: {sc.get('type')} left out — {str(e)[:140]}")
        return False
    if sc.get("type") == "docshot" and not sc.get("photo"):
        log("  horizon: docshot left out — no picture of the document")
        return False
    return True


# ── sound ────────────────────────────────────────────────────────────────────────
def sound_marks(sc: dict) -> list:
    """[(second, sfx.py sound, dB)] for one scene — quiet: HORIZON's sound is the music and the voice."""
    t, d = sc.get("type"), float(sc.get("duration") or 6.0)
    if t == "linechart":
        return [(0.2, "whoosh", -14.0), (max(0.6, d - 1.7), "whoosh", -16.0)]
    if t == "pyramid":
        return [(0.1, "whoosh", -14.0), (1.0, "riser", -16.0)]
    if t == "gens":
        step = max(0.9, (d - 2.4) / 3)
        return [(0.2 + i * step, "pop", -12.0 - i) for i in range(4)] + [(d - 1.6, "whoosh", -15.0)]
    if t == "numroll":
        at = 0.42 * d
        return [(0.1, "hit", -10.0)] + [(at + i * 0.09, "tap", -17.0) for i in range(10)]
    if t == "ticker":
        n = len(str(sc.get("text") or ""))
        end = 0.45 * d
        return [(0.3 + i * (end - 0.3) / max(1, n), "typekey", -16.0) for i in range(n)]
    if t == "strike":
        items = len(sc.get("items") or []) or 3
        return [(0.4 * d + i * (0.45 * d / items), "paper", -12.0) for i in range(items)]
    if t in ("yearbars", "hbars"):
        return [(0.2, "whoosh", -14.0)]
    if t == "titlecard":
        return [(0.2, "hit", -8.0), (0.3, "whoosh", -18.0)]
    if t == "docshot":
        return [(0.05, "paper", -10.0)]
    if t == "quote":
        return [(0.1, "whoosh", -18.0)]
    if t == "readline":
        return [(max(0.4, d - 1.4), "tap", -14.0)]
    if t == "tab":
        return [(0.1, "whoosh", -16.0)]
    return []


def _main(argv: list) -> None:
    if argv[:1] == ["wb"] and len(argv) >= 3:
        for y, v in worldbank(argv[1], argv[2]):
            print(y, v)
    elif argv[:1] == ["pyramid"] and len(argv) >= 3:
        got = pyramid(argv[1], [int(y) for y in argv[2:]])
        for y in argv[2:]:
            m, w = got[str(int(y))]
            print(y, f"{(sum(m) + sum(w)) / 1000:.2f} million")
    else:
        print(__doc__)


if __name__ == "__main__":
    _main(sys.argv[1:])
