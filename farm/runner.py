#!/usr/bin/env python3
"""farm/runner.py — what the rented machine runs, start to finish.

    python -m farm.runner

One pod, one video. It collects the job from the bucket, renders it exactly as
your own computer would, uploads the video, and switches the pod off.

Everything here is built around one fact: **a pod that stays switched on is the
only way this costs real money.** So the pod is turned off in a `finally`, after
a crash, after a timeout, and by a watchdog thread that does not need the render
to still be alive to fire. The log is uploaded before any of that, so a pod that
died at three in the morning has already told you why.
"""

from __future__ import annotations

import json
import os
import sys
import threading
import time
import traceback
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE))

from farm import spec as jobspec          # noqa: E402
from farm import state                    # noqa: E402
from farm.config import Config, load_env  # noqa: E402
from farm.s3 import S3Error               # noqa: E402

POD_ID = os.environ.get("RUNPOD_POD_ID", "") or os.environ.get("FARM_POD_ID", "")
TAG = POD_ID or f"local-{int(time.time())}"

# What comes home. Everything else in a job folder — the raw footage, the
# segments, the frame sequences — is working material that weighs gigabytes and
# is of no use once the video exists.
KEEP = ("thumbnail.png", "thumbnail_1.png", "thumbnail_2.png", "thumbnail_3.png",
        "thumbnail_4.png", "youtube.txt", "chapters_youtube.txt", "subs.srt",
        "script.txt", "title.txt", "style.txt")

LOG_LINES: list = []
_LOG_LOCK = threading.Lock()


def log(line: str) -> None:
    line = str(line).rstrip()
    print(line, flush=True)
    with _LOG_LOCK:
        LOG_LINES.append(line)


def _log_blob() -> bytes:
    with _LOG_LOCK:
        return ("\n".join(LOG_LINES) + "\n").encode("utf-8", "replace")


class Reporter:
    """Keeps the bucket told what is happening, so your Mac can watch.

    Failing to report is never allowed to end a render — the pod is mid-video
    and the bucket being briefly unreachable is not a reason to throw it away.
    """

    def __init__(self, bucket, slug: str, title: str):
        self.bucket, self.slug, self.title = bucket, slug, title
        self.started = time.time()
        self.state = "starting"
        self.error = ""
        self.outputs: list = []
        self._stop = threading.Event()
        self._thread = None

    def status(self) -> dict:
        return {"slug": self.slug, "title": self.title, "state": self.state,
                "pod": POD_ID, "started": self.started, "updated": time.time(),
                "elapsed": int(time.time() - self.started), "error": self.error,
                "outputs": self.outputs,
                "line": (LOG_LINES[-1] if LOG_LINES else "")}

    def push(self) -> None:
        try:
            self.bucket.put_bytes(f"status/{self.slug}.json",
                                  json.dumps(self.status()).encode("utf-8"),
                                  "application/json")
            self.bucket.put_bytes(f"logs/{self.slug}.log", _log_blob(),
                                  "text/plain; charset=utf-8")
        except (S3Error, OSError, ValueError):
            pass

    def _loop(self) -> None:
        while not self._stop.wait(20):
            self.push()

    def start(self) -> None:
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()


def switch_off(why: str) -> None:
    """Give the machine back. Never raises — the caller is usually already
    handling something worse."""
    if not POD_ID:
        log(f"(not on a pod — would switch off now: {why})")
        return
    try:
        from farm.runpod import RunPod
        ok = RunPod(os.environ.get("RUNPOD_API_KEY", "")).terminate(POD_ID)
        log(f"pod {POD_ID}: {'terminated' if ok else 'TERMINATE FAILED'} — {why}")
        if not ok:
            log("!! switch it off yourself: runpod.io console, or `python -m farm.farm kill`")
    except Exception as e:                              # noqa: BLE001 - must not raise
        log(f"!! could not terminate pod {POD_ID}: {e}")
        log("!! switch it off yourself: runpod.io console, or `python -m farm.farm kill`")


def watchdog(minutes: int, reporter: Reporter) -> None:
    """The last line of defence: a render that hangs still stops costing money.

    It is a daemon thread with nothing to do but sleep, so it fires whether the
    render is stuck in ffmpeg, blocked on a socket, or deadlocked. `os._exit` is
    deliberate — a normal exit would wait for the very threads that are stuck.
    """
    def run():
        time.sleep(minutes * 60)
        log(f"!! watchdog: {minutes} minutes reached, giving the machine back")
        reporter.state, reporter.error = "timeout", f"watchdog stopped it after {minutes} min"
        reporter.push()
        switch_off("watchdog")
        time.sleep(5)
        os._exit(2)
    threading.Thread(target=run, daemon=True).start()


def upload_outputs(bucket, job: Path, final: Path, reporter: Reporter) -> list:
    """The video first — it is the thing you are waiting for."""
    sent = []
    if final and final.exists():
        key = f"out/{reporter.slug}/{final.name}"
        mb = bucket.put_file(key, final) / 1024 ** 2
        log(f"uploaded {final.name} ({mb:.0f} MB)")
        sent.append(key)
        reporter.outputs = list(sent)
        reporter.push()
    for name in KEEP:
        f = job / name
        if not f.is_file():
            continue
        try:
            bucket.put_file(f"out/{reporter.slug}/{name}", f)
            sent.append(f"out/{reporter.slug}/{name}")
        except S3Error as e:
            log(f"  (could not upload {name}: {e})")
    reporter.outputs = list(sent)
    return sent


def run_post(steps: list, job: Path, reporter: Reporter) -> bool:
    """The finishing passes a spec asks for, one after another, after the render.

    Each step is {"name": ..., "argv": [...]} with "{py}", "{job}" and "{frontier}" filled in here — for instance
    the footage upgrade and the shot judge that a channel runs on its finished video. They run as their own
    processes, so a crash in one is an exit code, not the end of the pod; the first failure stops the chain,
    because every pass works on what the one before it left.
    """
    import subprocess
    env = dict(os.environ, FRONTIER_HOME=str(HERE), PYTHONUNBUFFERED="1")
    for st in steps:
        name = str(st.get("name") or "step")
        argv = [str(a).replace("{py}", sys.executable).replace("{job}", str(job)).replace("{frontier}", str(HERE))
                for a in st.get("argv") or []]
        if not argv:
            continue
        reporter.state = f"finishing: {name}"
        reporter.push()
        log(f"── {name} ──")
        t0 = time.time()
        try:
            p = subprocess.Popen(argv, cwd=str(HERE), env=env, stdout=subprocess.PIPE,
                                 stderr=subprocess.STDOUT, text=True, errors="replace")
            for line in p.stdout:
                log("  " + line.rstrip())
            rc = p.wait()
        except OSError as e:
            log(f"  could not start {name}: {e}")
            rc = -1
        log(f"── {name}: exit {rc} after {int(time.time() - t0) // 60} min")
        if rc != 0:
            return False
    return True


def fetch_assets(job: Path) -> int:
    """Unpack the prepared half of this video, if the Mac sent one.

    Never fatal: an absent or broken bundle just means the pipeline finds the
    work still to do and does it, which is how it behaved before any of this.
    """
    url = os.environ.get("FARM_ASSETS_URL", "")
    if not url:
        log("no prepared assets — this pod makes the whole video")
        return 0
    blob = Path("/tmp/frontier-assets.zip")
    try:
        import requests
        with requests.get(url, stream=True, timeout=900) as r:
            r.raise_for_status()
            with blob.open("wb") as f:
                for block in r.iter_content(1 << 20):
                    f.write(block)
        from farm import assets
        n = assets.unpack(blob, job)
        log(f"unpacked {n} prepared file(s) ({blob.stat().st_size / 1024 ** 2:.1f} MB) — "
            "the script, voice, stills and edit plan are already done")
        return n
    except Exception as e:                              # noqa: BLE001 - the pipeline can redo it
        log(f"could not use the prepared assets ({str(e)[:140]}) — making them here instead")
        return 0
    finally:
        blob.unlink(missing_ok=True)


def main() -> int:
    load_env()
    cfg = Config()
    job_key = os.environ.get("FARM_JOB_KEY", "")
    if not job_key:
        print("FARM_JOB_KEY is not set — this is not a farm pod", file=sys.stderr)
        return 2

    from farm.config import bucket_from
    bucket = bucket_from(cfg)

    spec = json.loads(bucket.get_bytes(job_key).decode("utf-8"))
    slug, title = spec.get("slug") or "video", spec.get("title") or ""
    # render settings this job asks for (what a channel's own machine exports before it renders); set before the
    # engine is imported, because it reads them at import time
    for k, v in (spec.get("env") or {}).items():
        os.environ[str(k)] = str(v)
    reporter = Reporter(bucket, slug, title)
    reporter.start()
    watchdog(cfg.max_minutes, reporter)

    log(f"Frontier farm — {title!r}")
    log(f"pod {POD_ID or '(none)'} · channel {spec.get('style')} · "
        f"{spec.get('minutes')} min · watchdog {cfg.max_minutes} min")

    code = 1
    try:
        import make_video as mv
        import motion
        import styles
        styles.apply_to_engine(mv, motion)

        # What the Mac already made — voice, stills, the director's plan. The
        # pipeline skips any step whose output is on disk, so putting these in
        # place before it runs is the whole saving: the pod starts at the
        # footage instead of paying to wait on the same APIs a second time.
        fetch_assets(mv.job_dir(title or slug, spec.get("style") or ""))

        before = state.pull(bucket, HERE)
        log(f"footage memory: {sum(len(v or ()) for v in before.values() if v is not None)} entries")

        reporter.state = "rendering"
        reporter.push()
        kwargs = jobspec.run_kwargs(spec)
        kwargs["sink"] = log
        final = mv.run_custom(**kwargs)
        job = mv.job_dir(title or slug, spec.get("style") or "")

        post = spec.get("post") or []
        if post and final and Path(final).exists():
            # The render goes up before any finishing pass touches it: a pass that fails, or a watchdog that
            # fires in the middle of one, must never cost the video that already exists.
            reporter.state = "uploading the base render"
            reporter.push()
            base = Path(final)
            key = f"out/{slug}/base/{base.name}"
            mb = bucket.put_file(key, base) / 1024 ** 2
            log(f"uploaded the base render {base.name} ({mb:.0f} MB) — safe before the finishing passes")
            if run_post(post, job, reporter):
                final = mv.final_video(job)
                for extra in sorted((job / "_delivery").glob("*.popis.txt")):
                    try:
                        bucket.put_file(f"out/{slug}/{extra.name}", extra)
                    except S3Error as e:
                        log(f"  (could not upload {extra.name}: {e})")
            else:
                reporter.error = f"a finishing pass failed — the base render is the result: {key}"
                log("!! a finishing pass failed — the base render is the result")
                final = None                    # already in the bucket; not sent a second time

        reporter.state = "uploading"
        reporter.push()
        upload_outputs(bucket, job, Path(final) if final else None, reporter)
        if post:
            reporter.outputs = [k for k in reporter.outputs] + [f"out/{slug}/base/"]

        for key in state.push_delta(bucket, HERE, before, TAG):
            log(f"footage memory: wrote {key}")

        spend = mv.claude_spend_line()
        if spend:
            log(spend)              # read back later by `farm.farm report`
        reporter.state = "done"
        log(f"DONE in {int(time.time() - reporter.started) // 60} min")
        code = 0
    except BaseException as e:                          # noqa: BLE001 - report everything
        reporter.state = "failed"
        reporter.error = f"{type(e).__name__}: {e}"[:500]
        log("RENDER FAILED")
        for line in traceback.format_exc().splitlines():
            log("  " + line)
    finally:
        # Tell the story before giving the machine back, in that order: once the
        # pod is gone there is nothing left to ask what happened.
        reporter.stop()
        reporter.push()
        switch_off(reporter.state)
    return code


if __name__ == "__main__":
    raise SystemExit(main())
