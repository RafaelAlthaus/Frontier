"""farm/runpod.py — rent a Linux box, then give it back.

RunPod's REST API, v2 (`https://api.runpod.io/v2`). v1 is switched off on
15 November 2026, so nothing here speaks it.

The one function that matters is `terminate`. A pod that renders a video and
stays switched on is the only way this costs real money, so it retries, it
accepts "already gone" as success, and it is called from four places: the pod
itself when the render ends, the pod's own watchdog, your Mac while it waits,
and `python -m farm.farm kill` when you just want everything off.
"""

from __future__ import annotations

import time

import requests

BASE = "https://api.runpod.io/v2"


class RunPodError(RuntimeError):
    pass


class RunPod:
    def __init__(self, api_key: str, session: requests.Session | None = None):
        if not api_key:
            raise RunPodError("no RUNPOD_API_KEY — runpod.io → Settings → API Keys")
        self.key = api_key
        self.http = session or requests.Session()

    def _call(self, method: str, path: str, body: dict | None = None,
              timeout: int = 60, tries: int = 3):
        last = ""
        for attempt in range(tries):
            try:
                r = self.http.request(method, f"{BASE}{path}", json=body, timeout=timeout,
                                      headers={"Authorization": f"Bearer {self.key}",
                                               "Content-Type": "application/json"})
            except requests.RequestException as e:
                last = str(e)[:200]
            else:
                if r.status_code < 400:
                    if not r.content:
                        return {}
                    try:
                        return r.json()
                    except ValueError:
                        return {}
                # RFC 9457: {"title": ..., "status": ..., "detail": ...}
                try:
                    p = r.json()
                    last = f"HTTP {r.status_code}: {p.get('detail') or p.get('title') or p}"
                except ValueError:
                    last = f"HTTP {r.status_code}: {(r.text or '')[:200]}"
                if r.status_code < 500 and r.status_code != 429:
                    raise RunPodError(f"{method} {path} — {last}")
            if attempt < tries - 1:
                time.sleep(2 ** attempt * 2)
        raise RunPodError(f"{method} {path} — {last}")

    # ── pods ───────────────────────────────────────────────────────────────

    def create(self, *, name: str, image: str, env: dict, args: str,
               disk_gb: int = 150, gpu: str = "", cpu: str = "", vcpu: int = 8,
               min_ram: int = 24, cloud: str = "COMMUNITY",
               datacenters: list | None = None) -> dict:
        """Rent one machine and start it on `args`.

        Exactly one of `gpu` / `cpu`: a GPU pod asks for a card and is given
        processors alongside it; a CPU pod asks for processors directly.
        """
        body: dict = {"name": name, "image": image, "disk": disk_gb,
                      "env": env, "args": args, "cloud": cloud}
        if cpu:
            body["cpu"] = {"id": cpu, "vcpuCount": vcpu}
        else:
            body["gpu"] = {"id": gpu, "count": 1,
                           "minVcpuCountPerGpu": vcpu, "minRamPerGpu": min_ram}
        if datacenters:
            body["dataCenterIds"] = datacenters
        pod = self._call("POST", "/pods", body)
        if not pod.get("id"):
            raise RunPodError(f"RunPod accepted the request but returned no pod id: {pod}")
        return pod

    def get(self, pod_id: str) -> dict:
        return self._call("GET", f"/pods/{pod_id}", tries=2)

    def list(self) -> list:
        out = self._call("GET", "/pods", tries=2)
        return out.get("pods", []) if isinstance(out, dict) else (out or [])

    def terminate(self, pod_id: str, tries: int = 6) -> bool:
        """Switch a pod off and stop paying for it. True once it is gone.

        A pod that has already been deleted answers 404, which is the outcome we
        wanted, so it counts as success. Both routes are tried because this is
        the call that must not fail: if it ever does, the pod bills by the hour
        until somebody notices.
        """
        for attempt in range(tries):
            for method, path, body in (
                    ("DELETE", f"/pods/{pod_id}", None),
                    ("POST", f"/pods/{pod_id}/action", {"action": "terminate"})):
                try:
                    self._call(method, path, body, timeout=30, tries=1)
                    return True
                except RunPodError as e:
                    if "HTTP 404" in str(e):
                        return True
            if attempt < tries - 1:
                time.sleep(min(30, 2 ** attempt * 2))
        return False

    # ── catalogue ──────────────────────────────────────────────────────────

    def gpus(self) -> list:
        """What is rentable right now, for `farm.py machines`.

        Informational only — renting uses FARM_GPU by name — so a shape we do
        not recognise costs you a nicer listing, never a render.
        """
        out = self._call("GET", "/catalog/gpus", tries=2)
        return out.get("gpus", []) if isinstance(out, dict) else (out or [])

    def cpus(self) -> list:
        out = self._call("GET", "/catalog/cpus", tries=2)
        return out.get("cpus", []) if isinstance(out, dict) else (out or [])


def price_of(pod: dict) -> float:
    """What this pod costs an hour, whichever field the API used to say so."""
    for key in ("cost", "costPerHr", "adjustedCostPerHr"):
        try:
            v = float(pod.get(key) or 0)
        except (TypeError, ValueError):
            continue
        if v:
            return v
    return 0.0


def cores_of(pod: dict) -> tuple:
    """(vCPUs, RAM GB) — the numbers that actually decide the render time."""
    gpu = pod.get("gpu") or {}
    vcpu = pod.get("vcpuCount") or gpu.get("vcpuCount") or 0
    ram = pod.get("memoryInGb") or pod.get("memory") or gpu.get("memory") or 0
    return int(vcpu or 0), int(ram or 0)
