#!/usr/bin/env python3
"""farm/boot.py — the first thing a rented pod runs.

It is handed to RunPod base64-encoded inside the container command, so no shell
quoting stands between your Mac and the machine. Nothing is installed yet when
this starts, so it uses only the standard library.

Its job is small and its failure mode is expensive, which is why it is a file
you can read rather than a line of shell: fetch Frontier, install what it needs,
hand over to the runner — and if any of that goes wrong, say so and give the
machine back instead of sitting there billing by the second.
"""

import base64
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
import zipfile

ROOT = "/frontier"
POD = os.environ.get("RUNPOD_POD_ID", "")


def say(msg: str) -> None:
    print(f"=== boot: {msg} ===", flush=True)


def report(state: str, error: str) -> None:
    """Put one status object where the Mac is already looking.

    The upload link was signed before the pod existed, so this works even though
    nothing is installed and Frontier itself may never have arrived.
    """
    url = os.environ.get("FARM_STATUS_URL", "")
    if not url:
        return
    body = json.dumps({"slug": os.environ.get("FARM_SLUG", ""),
                       "title": os.environ.get("FARM_TITLE", ""),
                       "state": state, "pod": POD, "error": error[:1000],
                       "updated": time.time(), "outputs": []}).encode("utf-8")
    try:
        req = urllib.request.Request(url, data=body, method="PUT",
                                     headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=30).read()
    except Exception as e:                              # noqa: BLE001 - best effort
        print(f"(could not report: {e})", flush=True)


def switch_off() -> None:
    """Give the machine back, with the standard library and nothing else."""
    key = os.environ.get("RUNPOD_API_KEY", "")
    if not (POD and key):
        print("!! no pod id or RunPod key — SWITCH THIS POD OFF YOURSELF", flush=True)
        return
    for attempt in range(5):
        try:
            req = urllib.request.Request(f"https://api.runpod.io/v2/pods/{POD}",
                                         method="DELETE",
                                         headers={"Authorization": f"Bearer {key}"})
            urllib.request.urlopen(req, timeout=30).read()
            print(f"pod {POD} terminated", flush=True)
            return
        except urllib.error.HTTPError as e:
            if e.code == 404:                           # already gone: what we wanted
                return
            print(f"terminate attempt {attempt + 1}: HTTP {e.code}", flush=True)
        except Exception as e:                          # noqa: BLE001
            print(f"terminate attempt {attempt + 1}: {e}", flush=True)
        time.sleep(min(30, 2 ** attempt * 2))
    print(f"!! POD {POD} IS STILL RUNNING — switch it off at runpod.io", flush=True)


def fetch_code() -> None:
    url = os.environ.get("FARM_CODE_URL", "")
    if not url:
        raise RuntimeError("FARM_CODE_URL is not set — nothing to download")
    say("fetching Frontier")
    last = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=600) as r, open("/tmp/frontier.zip", "wb") as f:
                while True:
                    block = r.read(1 << 20)
                    if not block:
                        break
                    f.write(block)
            size = os.path.getsize("/tmp/frontier.zip")
            if size < 1024:
                raise RuntimeError(f"the download is only {size} bytes — link expired?")
            say(f"got {size / 1024 ** 2:.0f} MB")
            os.makedirs(ROOT, exist_ok=True)
            with zipfile.ZipFile("/tmp/frontier.zip") as z:
                z.extractall(ROOT)
            return
        except Exception as e:                          # noqa: BLE001
            last = e
            print(f"download attempt {attempt + 1} failed: {e}", flush=True)
            time.sleep(5 * (attempt + 1))
    raise RuntimeError(f"could not fetch Frontier: {last}")


def main() -> int:
    try:
        fetch_code()
        os.chdir(ROOT)
        say("installing")
        subprocess.run(["bash", "farm/provision.sh"], check=True)
    except Exception as e:                              # noqa: BLE001
        print(f"!! boot failed: {e}", flush=True)
        report("failed", f"boot: {e}")
        switch_off()
        return 1

    # From here the runner owns the pod, including switching it off. Replacing
    # this process rather than waiting on it means no parent left to hang.
    say("handing over to the renderer")
    os.execv(sys.executable, [sys.executable, "-m", "farm.runner"])
    return 0                                            # not reached


if __name__ == "__main__":
    raise SystemExit(main())


def container_args(boot_source: str) -> str:
    """The container command RunPod is given, with this file carried inside it.

    base64 so that nothing in the bootstrap — a quote, a dollar sign, a newline —
    can be mangled on its way through JSON and a shell. `exec` keeps the Python
    process as PID 1, so RunPod's stop signal reaches it rather than a shell.
    """
    blob = base64.b64encode(boot_source.encode("utf-8")).decode("ascii")
    return ("bash -lc 'echo " + blob +
            " | base64 -d > /boot.py && exec python -u /boot.py'")
