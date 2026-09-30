#!/usr/bin/env python3
"""farm/farm.py — the render farm, driven from your own computer.

    python -m farm.farm check                       # before you spend anything
    python -m farm.farm queue "New Coke: ..." --style documentary
    python -m farm.farm run --pods 5
    python -m farm.farm pull
    python -m farm.farm kill                        # switch everything off, now

Your Mac writes the scripts and keeps the queue. It rents one machine per video,
each of which renders, uploads and switches itself off. Nothing heavy is ever
uploaded from here: a job is a few kilobytes of JSON, and the voice, pictures
and footage are made where the connection is a datacentre's.

The scripts are written here on purpose. It is the one step that is free —
Claude Code is already signed in on this machine, where a pod would have to buy
the same words through the API — and it is the step you want to read before any
money is spent on saying it out loud.
"""

from __future__ import annotations

import argparse
import fnmatch
import hashlib
import json
import os
import re
import sys
import time
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE))

from farm import assets                     # noqa: E402
from farm import spec as jobspec            # noqa: E402
from farm import state                      # noqa: E402
from farm.config import Config, bucket_from, load_env   # noqa: E402
from farm.s3 import S3Error                 # noqa: E402

QUEUE_DIR = HERE / "farm_queue"
DONE_DIR = QUEUE_DIR / "sent"
PULL_DIR = HERE / "output"

# What never leaves this computer. Your .env is the important one — the pod is
# given its keys by RunPod, encrypted, and the bucket never sees them.
BUNDLE_SKIP = (
    ".env", ".env.*", "*.pyc", "__pycache__", ".git", ".DS_Store", "*.zip",
    "output", "docs", "preview", "farm_queue", "motion_preview", ".venv",
    "*.bak-*", "*.bak", "youtube_used.json", "pexels_used.json",
    "assets/brand",            # channel sample videos: 57 MB the pod never plays
    "tools/vtrack",            # a compiled macOS binary
)


def _skip(rel: str) -> bool:
    parts = rel.split("/")
    for pat in BUNDLE_SKIP:
        if "/" in pat:
            if rel == pat or rel.startswith(pat + "/"):
                return True
        elif any(fnmatch.fnmatch(p, pat) for p in parts):
            return True
    return False


# ── the code the pods run ──────────────────────────────────────────────────

def bundle(bucket, quiet: bool = False, sink=None) -> str:
    """Zip this Frontier, upload it once, and reuse it until it changes.

    The key is the digest of the contents, so editing a style file makes a new
    bundle and editing nothing costs nothing. Roughly 100 MB, uploaded once a
    day at most; the pods pull it back at datacentre speed in a few seconds.
    """
    files = []
    for p in sorted(HERE.rglob("*")):
        if not p.is_file():
            continue
        rel = p.relative_to(HERE).as_posix()
        if not _skip(rel):
            files.append((rel, p))

    digest = hashlib.sha256()
    for rel, p in files:
        digest.update(rel.encode("utf-8"))
        digest.update(str(p.stat().st_size).encode())
        digest.update(str(int(p.stat().st_mtime)).encode())
    key = f"code/frontier-{digest.hexdigest()[:12]}.zip"

    if bucket.exists(key):
        if not quiet:
            (sink or print)(f"  code: already uploaded ({key.split('/')[-1]})")
        return key

    zpath = HERE / ".farm-bundle.zip"
    if not quiet:
        (sink or print)(f"  code: packing {len(files)} files…")
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for rel, p in files:
            z.write(p, rel)
    mb = zpath.stat().st_size / 1024 ** 2
    if not quiet:
        (sink or print)(f"  code: uploading {mb:.0f} MB (once — reused until you edit Frontier)")
    bucket.put_file(key, zpath, "application/zip")
    zpath.unlink(missing_ok=True)
    return key


# ── what the farm has finished ─────────────────────────────────────────────

VIDEO_NAMES = (".mp4", ".mov")


def library(bucket) -> list:
    """Every video sitting in the bucket, newest first.

    One entry per job, with its files grouped: the video, the thumbnails, the
    description. The bucket is the only source — a pod uploads and disappears,
    so this is what actually exists rather than what this computer remembers.
    """
    jobs: dict = {}
    for obj in bucket.list("out/"):
        rel = obj["key"][len("out/"):]
        slug, _, name = rel.partition("/")
        if not (slug and name):
            continue
        job = jobs.setdefault(slug, {"slug": slug, "files": [], "bytes": 0,
                                     "modified": "", "video": "", "thumb": ""})
        job["files"].append({"name": name, "size": obj["size"], "modified": obj["modified"]})
        job["bytes"] += obj["size"]
        job["modified"] = max(job["modified"], obj["modified"] or "")
        low = name.lower()
        if low.endswith(VIDEO_NAMES) and not job["video"]:
            job["video"] = name
        elif low.startswith("thumbnail") and low.endswith((".png", ".jpg")) and not job["thumb"]:
            job["thumb"] = name
    for job in jobs.values():
        job["files"].sort(key=lambda f: (not f["name"].lower().endswith(VIDEO_NAMES), f["name"]))
    return sorted(jobs.values(), key=lambda j: j["modified"], reverse=True)


def cmd_library(args) -> int:
    load_env()
    cfg = Config()
    rows = library(bucket_from(cfg))
    if not rows:
        print("Nothing in the bucket yet.")
        return 0
    total = sum(r["bytes"] for r in rows)
    print(f"{len(rows)} video(s) in {cfg.bucket}, {total / 1024 ** 3:.2f} GB\n")
    for r in rows:
        mark = "🎬" if r["video"] else "  "
        print(f"  {mark} {r['slug'][:52]:<54}{r['bytes'] / 1024 ** 2:>7.0f} MB   {r['modified'][:16]}")
        if not r["video"]:
            print(f"       (no video — only {len(r['files'])} file(s); the render may have failed)")
    print("\n  python -m farm.farm pull          # bring them down")
    print("  python -m farm.farm pull --clean  # ...and free the bucket")
    return 0


# ── what one video cost ────────────────────────────────────────────────────

_STAMP = re.compile(r"^=== (.+?) ===\s*\[(\d+):(\d\d)\]\s*$")
_ALGROW = re.compile(r"algrow creditsUsed:\s*([0-9.]+)")
_WAVESPEED = re.compile(r"\$([0-9.]+) on WaveSpeed")
_CLAUDE = re.compile(r"Claude: (\d+) calls, ([\d,k.]+) in / ([\d,k.]+) out = \$([0-9.]+)")


def receipt(bucket, slug: str, price_per_hr: float = 0.0) -> dict:
    """What one video took and what it cost, read back off its own log.

    The pod writes its log to the bucket as it goes, and every stage header
    carries the elapsed time, so the breakdown is already there — this just adds
    it up. Money is only ever reported from what a service actually said it
    charged; nothing here is a guess at a price list.
    """
    out = {"slug": slug, "stages": [], "algrow": 0.0, "wavespeed": 0.0,
           "minutes": 0.0, "pod_usd": 0.0, "files": [], "bytes": 0,
           "stalls": 0, "retries": 0, "claude_usd": 0.0, "claude_calls": 0,
           "claude_in": "", "claude_out": ""}
    try:
        log = bucket.get_bytes(f"logs/{slug}.log").decode("utf-8", "replace")
    except S3Error:
        return out

    seen, last = set(), 0
    for line in log.splitlines():
        m = _STAMP.match(line.strip())
        if m:
            name, at = m.group(1), int(m.group(2)) * 60 + int(m.group(3))
            if (name, at) in seen:
                continue                    # the sink prints each header twice
            seen.add((name, at))
            out["stages"].append({"name": name, "at": at, "took": int(at - last)})
            last = at
        for rx, key in ((_ALGROW, "algrow"), (_WAVESPEED, "wavespeed")):
            for v in rx.findall(line):
                try:
                    out[key] += float(v)
                except ValueError:
                    pass
        m = _CLAUDE.search(line)
        if m:
            out["claude_calls"] = int(m.group(1))
            out["claude_in"], out["claude_out"] = m.group(2), m.group(3)
            out["claude_usd"] = float(m.group(4))
        if "no text in stream" in line:
            out["stalls"] += 1
        if "retrying" in line.lower():
            out["retries"] += 1

    try:
        st = json.loads(bucket.get_bytes(f"status/{slug}.json").decode("utf-8"))
        out["minutes"] = (st.get("elapsed") or 0) / 60.0
        out["state"] = st.get("state", "?")
    except (S3Error, ValueError, UnicodeDecodeError):
        out["state"] = "?"
    out["pod_usd"] = out["minutes"] / 60.0 * price_per_hr

    for row in library(bucket):
        if row["slug"] == slug:
            out["files"] = row["files"]
            out["bytes"] = row["bytes"]
    return out


def cmd_report(args) -> int:
    load_env()
    cfg = Config()
    bucket = bucket_from(cfg)
    slug = args.slug
    if not slug:
        rows = library(bucket)
        if not rows:
            print("Nothing finished yet.")
            return 0
        slug = rows[0]["slug"]

    r = receipt(bucket, slug, args.price)
    print(f"\n{slug}\n{'─' * min(78, max(40, len(slug)))}")
    print(f"  state            {r.get('state','?')}")
    print(f"  machine time     {r['minutes']:.1f} min")
    if args.price:
        print(f"  machine cost     ${r['pod_usd']:.3f}   (at ${args.price:.3f}/hr)")
    if r["algrow"]:
        print(f"  Algrow           {r['algrow']:.2f} credits")
    if r["wavespeed"]:
        print(f"  WaveSpeed        ${r['wavespeed']:.3f}")
    if r["claude_calls"]:
        print(f"  Claude           ${r['claude_usd']:.3f}   "
              f"({r['claude_calls']} calls, {r['claude_in']} in / {r['claude_out']} out)")
    total = r["pod_usd"] + r["wavespeed"] + r["claude_usd"]
    if total:
        print(f"  ── measured       ${total:.3f}  + {r['algrow']:.2f} Algrow credits")
    if r["stalls"] or r["retries"]:
        print(f"  hiccups          {r['stalls']} empty replies, {r['retries']} retries")
    if r["bytes"]:
        print(f"  delivered        {r['bytes'] / 1024 ** 2:.0f} MB in {len(r['files'])} file(s)")

    if r["stages"]:
        print("\n  where the time went")
        for st in r["stages"]:
            bar = "█" * max(0, min(34, int(st["took"] / max(1, r["minutes"] * 60) * 60)))
            print(f"    {st['took'] // 60:>3}:{st['took'] % 60:02d}  {st['name'][:42]:<44}{bar}")
    print("\n  Claude, voice, pictures and footage are billed by their own services —")
    print("  the figures above are only what the log saw them charge.")
    return 0


# ── check ──────────────────────────────────────────────────────────────────

def cmd_check(args) -> int:
    cfg = Config()
    bad = 0

    print("Frontier render farm — checking before you spend anything\n")

    missing = cfg.missing_for_mac()
    if missing:
        print("✗ .env is missing:")
        for m in missing:
            print(f"    {m}")
        print("\n  See README-RENDER-FARM.md — it is a Cloudflare account and a RunPod key.")
        return 1
    print("✓ .env has the farm settings")

    for m in cfg.missing_for_render():
        print(f"✗ {m}")
        bad = 1
    if not bad:
        print("✓ .env has the keys a pod needs to render")

    print("\nbucket — writing a test object, reading it back, deleting it")
    try:
        bucket = bucket_from(cfg)
        probe = f"check/{int(time.time())}-ěščř.txt"
        payload = b"frontier farm check"
        bucket.put_bytes(probe, payload, "text/plain; charset=utf-8")
        got = bucket.get_bytes(probe)
        assert got == payload, "what came back is not what went in"
        assert any(o["key"] == probe for o in bucket.list("check/")), "written but not listed"
        bucket.delete(probe)
        print(f"✓ bucket {cfg.bucket} — put, get, list and delete all work")
        print("   (the test key had Czech characters in it on purpose)")
    except (S3Error, AssertionError, Exception) as e:   # noqa: BLE001
        print(f"✗ bucket: {e}")
        print("   Check FARM_BUCKET_ENDPOINT is the S3 endpoint for your account,")
        print("   and that the R2 token is allowed to read AND write this bucket.")
        return 1

    print("\nRunPod")
    try:
        from farm.runpod import RunPod
        rp = RunPod(cfg.runpod_key)
        pods = rp.list()
        print(f"✓ key works — {len(pods)} pod(s) on the account right now")
        mine = [p for p in pods if str(p.get("name", "")).startswith(cfg.prefix)]
        if mine:
            print(f"  ⚠ {len(mine)} of them are farm pods and are still running:")
            for p in mine:
                print(f"      {p.get('name')}  {p.get('id')}  {p.get('status')}")
            print("    `python -m farm.farm kill` switches them off.")
    except Exception as e:                              # noqa: BLE001
        print(f"✗ RunPod: {e}")
        return 1

    print(f"\nplan: {cfg.cloud} {cfg.gpu or cfg.cpu_flavour}, at least {cfg.vcpu} vCPU / "
          f"{cfg.min_ram} GB, {cfg.disk_gb} GB disk")
    print(f"      at most {cfg.max_pods} pods at once, each killed after {cfg.max_minutes} min")
    print("\nNothing has been rented. `queue` then `run` when you are ready.")
    return bad


# ── queue ──────────────────────────────────────────────────────────────────

def finished_thumbs(slug: str) -> bool:
    """Does this job already have its thumbnails on this computer?"""
    try:
        import make_video as mv
        job = mv.find_job(slug)
        return bool(job) and any(job.glob("thumbnail*.png"))
    except (ImportError, OSError):
        return False


def finished_already(slug: str):
    """The video this slug already has on disk, if there is one.

    A job folder is named after the title, so queueing a title you have already
    made reuses that folder — and preparing it again clears the voice and the
    stills it holds. Worth a word before that happens rather than after.
    """
    try:
        import make_video as mv
        job = mv.find_job(slug)
    except ImportError:
        return None
    if not job:
        return None
    v = mv.final_video(job)
    if v.exists() and v.stat().st_size > 1_000_000:
        return v
    return next((p for p in sorted(job.glob("*.mp4")) if p.stat().st_size > 1_000_000), None)


def cmd_queue(args) -> int:
    load_env()
    titles = [t for t in args.title if t.strip()]
    if args.titles_file:
        titles += [ln.strip() for ln in Path(args.titles_file).read_text(
            encoding="utf-8").splitlines() if ln.strip()]
    if not titles:
        print("Give it a title, or --titles-file with one per line.")
        return 1

    script_text = ""
    if args.script:
        script_text = Path(args.script).read_text(encoding="utf-8").strip()
        if len(titles) > 1:
            print("--script is one script, so give it one title.")
            return 1

    QUEUE_DIR.mkdir(parents=True, exist_ok=True)
    made = []
    for title in titles:
        spec = jobspec.build(
            title, args.style, minutes=args.minutes, script_text=script_text,
            extra=args.extra or "", thumb_count=args.thumbs,
            burn_subs=not args.no_subs, force=args.force,
            steps=["video", "thumbnail"] if args.thumbs else ["video"])

        done = finished_already(spec["slug"])
        if done is not None and not args.force:
            print(f"✗ {title!r} already exists: output/{spec['slug']}/{done.name}")
            print("   Preparing it again would clear that job's voice and stills.")
            print("   Use a different title, or --force to redo it deliberately.")
            continue

        if not script_text and not args.no_prepare:
            spec["script_text"] = write_script_here(spec)

        problems = jobspec.problems(spec)
        if problems:
            print(f"✗ {title!r}: {'; '.join(problems)}")
            continue
        path = jobspec.save(spec, QUEUE_DIR / f"{spec['slug']}.json")
        words = len((spec["script_text"] or "").split())
        made.append(spec)
        print(f"queued  {spec['slug']}"
              + (f"   ({words} words of script)" if words else "   (script will be written on the pod)"))

    if made:
        print(f"\n{len(made)} job(s) waiting. Read the scripts in farm_queue/, then:")
        print(f"  python -m farm.farm run --pods {min(len(made), 5)}")
    return 0 if made else 1


def write_script_here(spec: dict, sink=None) -> str:
    """Do the waiting-shaped half of the video here, and return the script.

    Script, voiceover, AI stills, thumbnail, and the director's plan of the edit:
    every one of those is time spent waiting on somebody's API rather than on a
    processor, and a rented machine charges by the hour for waiting. Measured on
    real jobs, a stalled image step once waited 77 minutes and a stalled director
    50 — on a pod that is money; here it is nothing, and the Claude calls go
    through the Claude Code already signed in on this machine instead of being
    bought again.

    What it makes is small — a few megabytes — so sending it up takes seconds.
    If any of it fails the pod simply does it: every step is cached, so a missing
    file only ever means the work is still to do.
    """
    say = sink or (lambda line: print(line, flush=True))
    try:
        assets.prepare(spec, sink=say)
    except Exception as e:                              # noqa: BLE001 - the pod can still do it
        say(f"  (could not prepare it here: {e} — the pod will do it instead)")
    return _script_of(spec)


def _script_of(spec: dict) -> str:
    """The narration this job ended up with, if it got that far."""
    try:
        import make_video as mv
        return (mv.job_dir(spec.get("title") or spec["slug"], spec.get("style") or "") / "script.txt").read_text(encoding="utf-8").strip()
    except (OSError, ImportError):
        return ""


def cmd_list(args) -> int:
    jobs = sorted(QUEUE_DIR.glob("*.json"))
    if not jobs:
        print("Nothing queued.")
        return 0
    print(f"{len(jobs)} job(s) waiting:\n")
    for p in jobs:
        s = jobspec.load(p)
        words = len((s.get("script_text") or "").split())
        print(f"  {s['slug']:<54} {s.get('style','?'):<14} {s.get('minutes')} min  "
              f"{words or '-'} words")
    return 0


# ── run ────────────────────────────────────────────────────────────────────

def cmd_run(args) -> int:
    load_env()
    cfg = Config()
    if cfg.missing_for_mac():
        print("Run `python -m farm.farm check` first.")
        return 1
    jobs = [jobspec.load(p) for p in sorted(QUEUE_DIR.glob("*.json"))]
    if not jobs:
        print("Nothing queued. `queue` first.")
        return 1
    return run_queue(cfg, jobs, args.pods or 0)


def run_queue(cfg, jobs: list, pods: int = 0, sink=None) -> int:
    """Rent machines and render `jobs`, one machine each.

    The web UI and the command line both come through here, so there is one
    description of how a batch runs, not two that drift. `sink` takes each line
    of progress; the default prints it.
    """
    say = sink or (lambda line: print(line, flush=True))

    from farm.boot import container_args
    from farm.runpod import RunPod, price_of
    bucket = bucket_from(cfg)
    rp = RunPod(cfg.runpod_key)

    at_once = max(1, min(pods or cfg.max_pods, cfg.max_pods, len(jobs)))
    say(f"{len(jobs)} video(s), {at_once} machine(s) at a time, "
        f"each given up to {cfg.max_minutes} min")

    code_key = bundle(bucket, sink=say)
    code_url = bucket.presign(code_key, seconds=12 * 3600)
    boot_src = (HERE / "farm" / "boot.py").read_text(encoding="utf-8")
    args_str = container_args(boot_src)

    for name, n in state.seed(bucket, HERE):
        say(f"  footage memory: seeded {name} with {n} entries from this computer")

    for spec in jobs:                       # the specs go up before any pod exists
        # Checked here, not only when the job was queued: a spec written before
        # this rule existed still asks for a thumbnail, and the pod would dutifully
        # draw a second set and pay for them. What is already on disk wins.
        if "thumbnail" in (spec.get("steps") or []) and finished_thumbs(spec["slug"]):
            spec["steps"] = [x for x in spec["steps"] if x != "thumbnail"]
            say(f"  {spec['slug'][:40]}: thumbnails already drawn here — not asking the pod")

        bucket.put_bytes(f"jobs/{spec['slug']}.json",
                         json.dumps(spec, ensure_ascii=False).encode("utf-8"),
                         "application/json")
        bucket.put_bytes(f"status/{spec['slug']}.json",
                         json.dumps({"slug": spec["slug"], "title": spec["title"],
                                     "state": "queued", "updated": time.time()}).encode("utf-8"),
                         "application/json")

    pending, live, finished = list(jobs), {}, []
    # What the machines that have already finished cost. Without it, a pod's
    # share of the bill would vanish the moment it left `live`, so a batch of ten
    # videos would report the cost of the last one and never trip the budget.
    spent_done = 0.0
    spend = 0.0
    last_line: dict = {}
    try:
        while pending or live:
            while pending and len(live) < at_once:
                spec = pending.pop(0)
                assets_url = upload_assets(bucket, spec, sink=say)
                pod = start_pod(rp, cfg, bucket, spec, args_str, code_url, assets_url or "")
                if pod is None:
                    finished.append((spec, "failed to start"))
                    continue
                live[spec["slug"]] = {"pod": pod, "spec": spec, "since": time.time(),
                                      "price": price_of(pod)}
                say(f"▶ {spec['slug'][:46]:<46} pod {pod['id']}  "
                      f"${price_of(pod):.3f}/hr")

            time.sleep(15)
            spend = spent_done + sum(v["price"] * (time.time() - v["since"]) / 3600
                                     for v in live.values())
            for slug, info in list(live.items()):
                st = read_status(bucket, slug)
                mins = int((time.time() - info["since"]) / 60)
                line = (st.get("line") or st.get("state") or "")[:70]
                if line and line != last_line.get(slug):
                    last_line[slug] = line
                    say(f"   {slug[:40]:<40} {mins:>3} min  {line}")
                if st.get("state") in ("done", "failed", "timeout"):
                    say(f"{'✓' if st['state'] == 'done' else '✗'} {slug} — {st['state']}"
                          + (f": {st.get('error','')[:120]}" if st.get("error") else ""))
                    rp.terminate(info["pod"]["id"])      # it terminates itself; this is belt and braces
                    spent_done += info["price"] * (time.time() - info["since"]) / 3600
                    finished.append((info["spec"], st.get("state")))
                    live.pop(slug)
                elif mins > cfg.max_minutes + 5:
                    say(f"✗ {slug} — over its time, switching the machine off")
                    rp.terminate(info["pod"]["id"])
                    spent_done += info["price"] * (time.time() - info["since"]) / 3600
                    finished.append((info["spec"], "timeout"))
                    live.pop(slug)

            if spend > cfg.budget_usd:
                say(f"\n!! ${spend:.2f} spent, over FARM_BUDGET_USD (${cfg.budget_usd:.2f}).")
                say("   Switching everything off.")
                for info in live.values():
                    rp.terminate(info["pod"]["id"])
                break
    except KeyboardInterrupt:
        say("Interrupted. Switching off every machine that is still running…")
        for info in live.values():
            ok = rp.terminate(info["pod"]["id"])
            say(f"  {info['pod']['id']}: {'off' if ok else 'STILL ON — check runpod.io'}")
        return 130

    spend = spent_done + sum(v["price"] * (time.time() - v["since"]) / 3600
                             for v in live.values())
    ok = [s for s, r in finished if r == "done"]
    say(f"{len(ok)}/{len(finished)} rendered. Roughly ${spend:.2f} of machine time.")
    for spec, _ in finished:
        src = QUEUE_DIR / f"{spec['slug']}.json"
        if src.exists():
            DONE_DIR.mkdir(parents=True, exist_ok=True)
            src.replace(DONE_DIR / src.name)
    if ok:
        say("  python -m farm.farm pull      # bring the videos down")
    return 0


def upload_assets(bucket, spec: dict, sink=None):
    """Send up what this computer already made, and a link to fetch it with.

    A few megabytes — the voice, the stills, the director's plan — against a job
    folder that is hundreds. Returns None when there is nothing prepared, and the
    pod then does the whole video itself.
    """
    say = sink or (lambda line: print(line, flush=True))
    try:
        import make_video as mv
        job = mv.job_dir(spec.get("title") or spec["slug"], spec.get("style") or "")
    except ImportError:
        return None
    if not (job / "script.txt").exists():
        return None
    tmp = HERE / f".farm-assets-{spec['slug']}.zip"
    try:
        n = assets.pack(job, tmp)
        if not n:
            return None
        key = f"jobs/{spec['slug']}-assets.zip"
        mb = bucket.put_file(key, tmp, "application/zip") / 1024 ** 2
        say(f"  {spec['slug'][:40]}: sent {n} prepared files ({mb:.1f} MB)")
        return bucket.presign(key, seconds=12 * 3600)
    except (OSError, Exception) as e:                   # noqa: BLE001 - the pod can redo it
        say(f"  {spec['slug'][:40]}: could not send what was prepared ({str(e)[:90]}) — "
            "the pod will make it itself")
        return None
    finally:
        tmp.unlink(missing_ok=True)


def start_pod(rp, cfg, bucket, spec: dict, args_str: str, code_url: str, assets_url: str = ""):
    name = f"{cfg.prefix}-{spec['slug'][:28]}-{int(time.time()) % 100000}"
    env = cfg.pod_env(f"jobs/{spec['slug']}.json", {
        "FARM_CODE_URL": code_url,
        "FARM_ASSETS_URL": assets_url or "",
        "FARM_STATUS_URL": bucket.presign(f"status/{spec['slug']}.json",
                                          seconds=12 * 3600, method="PUT"),
        "FARM_SLUG": spec["slug"],
        "FARM_TITLE": spec["title"][:200],
    })
    try:
        return rp.create(name=name, image=cfg.image, env=env, args=args_str,
                         disk_gb=cfg.disk_gb, gpu=cfg.gpu, cpu=cfg.cpu_flavour,
                         vcpu=cfg.vcpu, min_ram=cfg.min_ram, cloud=cfg.cloud,
                         datacenters=cfg.datacenters)
    except Exception as e:                              # noqa: BLE001
        print(f"✗ {spec['slug']}: could not rent a machine — {e}")
        if "availab" in str(e).lower() or "capacity" in str(e).lower():
            print("   Nothing free of that kind right now. Try FARM_CLOUD=SECURE,")
            print("   or another card in FARM_GPU (`farm.farm machines` lists them).")
        return None


def read_status(bucket, slug: str) -> dict:
    try:
        return json.loads(bucket.get_bytes(f"status/{slug}.json").decode("utf-8"))
    except (S3Error, ValueError, UnicodeDecodeError):
        return {}


# ── status / pull / kill / machines ────────────────────────────────────────

def cmd_status(args) -> int:
    load_env()
    cfg = Config()
    bucket = bucket_from(cfg)
    rows = []
    for obj in bucket.list("status/"):
        try:
            rows.append(json.loads(bucket.get_bytes(obj["key"]).decode("utf-8")))
        except (S3Error, ValueError, UnicodeDecodeError):
            continue
    if not rows:
        print("Nothing in the bucket.")
        return 0
    for r in sorted(rows, key=lambda r: r.get("updated") or 0, reverse=True):
        age = int(time.time() - (r.get("updated") or time.time()))
        print(f"  {r.get('state','?'):<10} {str(r.get('slug'))[:44]:<44} "
              f"{r.get('elapsed', 0) // 60:>3} min   seen {age}s ago")
        if r.get("error"):
            print(f"             {r['error'][:110]}")

    from farm.runpod import RunPod
    live = [p for p in RunPod(cfg.runpod_key).list()
            if str(p.get("name", "")).startswith(cfg.prefix)]
    print(f"\n{len(live)} farm pod(s) running." + ("  `kill` switches them off." if live else ""))
    return 0


def cmd_pull(args) -> int:
    load_env()
    cfg = Config()
    bucket = bucket_from(cfg)
    import make_video as mv
    got = 0
    by_slug: dict = {}
    for obj in bucket.list("out/"):
        slug, _, name = obj["key"][len("out/"):].partition("/")
        if slug and name and "/" not in name and name not in (".", "..") and not name.startswith("."):
            by_slug.setdefault(slug, []).append((name, obj))
    for slug, files in by_slug.items():
        job = mv.find_job(slug)
        if job is None:
            # the pod sent its title and channel along: that is where the video belongs
            for name, obj in files:
                if name in ("title.txt", "style.txt"):
                    bucket.get_file(obj["key"], PULL_DIR / ".pull" / slug / name)
            f = PULL_DIR / ".pull" / slug / "style.txt"
            style = f.read_text(encoding="utf-8").splitlines()[0].strip() if f.exists() else ""
            job = mv.OUTPUT_ROOT / mv.style_folder(style) / mv.WORK_DIR / slug
        job.mkdir(parents=True, exist_ok=True)
        fresh = ""
        for name, obj in files:
            dest = job / name
            if dest.exists() and dest.stat().st_size == obj["size"]:
                continue
            mb = obj["size"] / 1024 ** 2
            print(f"  {slug}/{name}  ({mb:.0f} MB)" if mb >= 1 else f"  {slug}/{name}")
            bucket.get_file(obj["key"], dest)
            got += 1
            if name.lower().endswith((".mp4", ".mov")):
                fresh = name
            if args.clean:
                bucket.delete(obj["key"])
        t = job / "title.txt"
        title = t.read_text(encoding="utf-8").splitlines()[0] if t.exists() else (Path(fresh).stem if fresh else slug)
        if fresh:
            mv.publish_named_copy(job, title, fresh=fresh)

    counts = state.fold_in(bucket, HERE)
    if counts:
        print("\nfootage memory folded back in: "
              + ", ".join(f"{k} = {v}" for k, v in counts.items()))
    print(f"\n{got} file(s) into {mv.OUTPUT_ROOT}, each video in its channel's folder" if got else "\nNothing new to fetch.")
    if got and not args.clean:
        print("  --clean deletes them from the bucket once they are down.")
    return 0


def cmd_kill(args) -> int:
    load_env()
    cfg = Config()
    from farm.runpod import RunPod
    rp = RunPod(cfg.runpod_key)
    pods = [p for p in rp.list() if args.all or str(p.get("name", "")).startswith(cfg.prefix)]
    if not pods:
        print("No farm pods running.")
        return 0
    print(f"Switching off {len(pods)} pod(s):")
    bad = 0
    killed = set()
    for p in pods:
        ok = rp.terminate(p["id"])
        bad += not ok
        killed.add(p["id"])
        print(f"  {p.get('name','?')[:44]:<44} {p['id']}  {'off' if ok else 'FAILED'}")

    # A pod that is switched off mid-render never gets to say so, and its last
    # status sits in the bucket looking like work in progress — to `status`, to
    # the app, and to anyone reading it an hour later. Mark them.
    try:
        bucket = bucket_from(cfg)
        for obj in bucket.list("status/"):
            try:
                st = json.loads(bucket.get_bytes(obj["key"]).decode("utf-8"))
            except (S3Error, ValueError, UnicodeDecodeError):
                continue
            if st.get("state") in ("queued", "starting", "rendering", "uploading") \
                    and (not st.get("pod") or st.get("pod") in killed or args.all):
                st["state"] = "stopped"
                st["error"] = "switched off before it finished"
                st["updated"] = time.time()
                bucket.put_bytes(obj["key"], json.dumps(st).encode("utf-8"), "application/json")
                print(f"  marked {st.get('slug','?')[:44]} as stopped")
    except Exception as e:                              # noqa: BLE001 - the pods are off, which is what matters
        print(f"  (could not update the bucket's statuses: {str(e)[:90]})")
    if bad:
        print(f"\n!! {bad} would not switch off. Do it at runpod.io/console/pods — they are still billing.")
    return 1 if bad else 0


def cmd_machines(args) -> int:
    load_env()
    cfg = Config()
    from farm.runpod import RunPod
    rp = RunPod(cfg.runpod_key)
    print("Frontier renders on processors, not on the graphics card: Chromium draws")
    print("the motion graphics with --disable-gpu and ffmpeg encodes with libx264.")
    print("So the number that matters below is vCPU, and the card is what you pay")
    print("to get them — on RunPod a cheap GPU pod is often the least costly way.\n")
    try:
        rows = rp.gpus()
    except Exception as e:                              # noqa: BLE001
        print(f"Could not read the catalogue: {e}")
        print("Prices are on the RunPod console when you deploy.")
        return 1
    out = []
    for g in rows:
        name = g.get("displayName") or g.get("id") or "?"
        price = g.get("communityPrice") or g.get("securePrice") or g.get("price") or 0
        vcpu = g.get("vcpuCount") or g.get("minVcpu") or 0
        ram = g.get("memoryInGb") or g.get("memory") or 0
        try:
            price = float(price)
        except (TypeError, ValueError):
            price = 0.0
        if price:
            out.append((price, name, int(vcpu or 0), int(ram or 0)))
    if not out:
        print(json.dumps(rows[:3], indent=2)[:1200])
        print("\n(The catalogue came back in a shape this does not read — the prices")
        print(" on runpod.io are the ones that count.)")
        return 0
    print(f"{'$/hr':>7}  {'vCPU':>4}  {'RAM':>5}   card")
    for price, name, vcpu, ram in sorted(out)[:25]:
        print(f"{price:>7.3f}  {vcpu:>4}  {ram:>4}G   {name}")
    print(f"\nFARM_GPU is currently {cfg.gpu!r}.")
    return 0


# ── cli ────────────────────────────────────────────────────────────────────

def main() -> int:
    ap = argparse.ArgumentParser(prog="farm.farm", description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("check", help="is everything set up? rents nothing").set_defaults(fn=cmd_check)

    q = sub.add_parser("queue", help="add a video to the queue (writes the script here)")
    q.add_argument("title", nargs="*")
    q.add_argument("--style", required=True, help="channel, e.g. documentary")
    q.add_argument("--minutes", type=int, default=20)
    q.add_argument("--titles-file", help="a file with one title per line")
    q.add_argument("--script", help="a finished script to narrate instead")
    q.add_argument("--no-prepare", "--no-script", dest="no_prepare", action="store_true",
                   help="queue it without preparing anything here — the pod then does the "
                        "script, voice, stills and edit plan too, on its own clock and "
                        "Anthropic's meter instead of your Claude Code")
    q.add_argument("--extra", default="", help="extra instructions for this video")
    q.add_argument("--thumbs", type=int, default=2)
    q.add_argument("--no-subs", action="store_true")
    q.add_argument("--force", action="store_true")
    q.set_defaults(fn=cmd_queue)

    sub.add_parser("list", help="what is queued").set_defaults(fn=cmd_list)

    r = sub.add_parser("run", help="rent machines and render the queue")
    r.add_argument("--pods", type=int, default=0, help="how many at once")
    r.set_defaults(fn=cmd_run)

    sub.add_parser("status", help="what the farm is doing").set_defaults(fn=cmd_status)

    p = sub.add_parser("pull", help="bring finished videos down")
    p.add_argument("--clean", action="store_true", help="delete them from the bucket too")
    p.set_defaults(fn=cmd_pull)

    k = sub.add_parser("kill", help="switch every farm pod off, now")
    k.add_argument("--all", action="store_true", help="every pod on the account, not just the farm's")
    k.set_defaults(fn=cmd_kill)

    sub.add_parser("library", help="what the farm has finished and left in the bucket").set_defaults(fn=cmd_library)

    rep = sub.add_parser("report", help="what one video took and what it cost")
    rep.add_argument("slug", nargs="?", help="default: the most recent")
    rep.add_argument("--price", type=float, default=0.17, help="$/hr you paid for the machine")
    rep.set_defaults(fn=cmd_report)
    sub.add_parser("machines", help="what is rentable, and what it costs").set_defaults(fn=cmd_machines)

    args = ap.parse_args()
    load_env()
    return args.fn(args) or 0


if __name__ == "__main__":
    raise SystemExit(main())
