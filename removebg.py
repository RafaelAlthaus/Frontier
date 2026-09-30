"""removebg.py — a picture with its background removed, whatever balance runs out.

WaveSpeed's background remover while its balance is above the reserve (WAVESPEED_RESERVE_USD), kie.ai's Recraft
remover otherwise — or kie first with PHOTOFX_REMOVER=kie — so a spotlight photo, a real object or a collage
cutout never stops for one empty account. Each service takes the picture as a link: WaveSpeed hosts it itself,
kie.ai through its own file upload.
"""

import json
import os
import time
from pathlib import Path

import requests
from PIL import Image

KIE_JOBS = "https://api.kie.ai/api/v1/jobs"
KIE_UPLOAD = "https://kieai.redpandaai.co/api/file-stream-upload"
KIE_MODEL = os.environ.get("KIE_REMOVER_MODEL", "recraft/remove-background")
WAVESPEED_MODEL = os.environ.get("PHOTOFX_REMOVER", "wavespeed-ai/image-background-remover")


def _env(name: str) -> str:
    return (os.environ.get(name) or "").strip()


def kie_upload(path: Path, kind: str = "image/jpeg") -> str:
    """A kie.ai-hosted link for a local file (the links last about a day — enough for one video)."""
    path = Path(path)
    with path.open("rb") as fh:
        r = requests.post(KIE_UPLOAD, headers={"Authorization": f"Bearer {_env('KIE_API_KEY')}"},
                          data={"uploadPath": "frontier", "fileName": path.name},
                          files={"file": (path.name, fh, kind)}, timeout=300)
    r.raise_for_status()
    d = (r.json() or {}).get("data") or {}
    url = d.get("downloadUrl") or d.get("fileUrl") or d.get("url")
    if not url:
        raise RuntimeError(f"kie upload returned no link: {r.text[:160]}")
    return url


def _small_jpeg(src: Path) -> Path:
    """The picture as a JPEG kie.ai accepts: 256 to 4096 px, under 5 MB."""
    im = Image.open(src)
    if im.mode in ("RGBA", "LA", "P"):
        im = im.convert("RGBA")
        base = Image.new("RGBA", im.size, (255, 255, 255, 255))
        base.alpha_composite(im)
        im = base
    im = im.convert("RGB")
    im.thumbnail((2048, 2048), Image.LANCZOS)
    if min(im.size) < 256:
        s = 256 / min(im.size)
        im = im.resize((max(256, int(im.width * s)), max(256, int(im.height * s))), Image.LANCZOS)
    out = src.with_name(src.stem + "_kie.jpg")
    im.save(out, "JPEG", quality=92)
    return out


def kie_remove(src: Path, dest: Path, log=print, timeout_s: int = 300) -> Path:
    """dest: the picture with its background removed by kie.ai's Recraft remover (a transparent PNG)."""
    key = _env("KIE_API_KEY")
    if not key:
        raise RuntimeError("KIE_API_KEY is not set")
    small = _small_jpeg(Path(src))
    try:
        url = kie_upload(small)
    finally:
        small.unlink(missing_ok=True)
    head = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    r = requests.post(f"{KIE_JOBS}/createTask", headers=head, json={"model": KIE_MODEL, "input": {"image": url}}, timeout=60)
    r.raise_for_status()
    d = r.json() or {}
    task = (d.get("data") or {}).get("taskId")
    if not task:
        raise RuntimeError(f"kie remover did not start: {str(d)[:160]}")
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        time.sleep(3)
        try:
            q = requests.get(f"{KIE_JOBS}/recordInfo", headers=head, params={"taskId": task}, timeout=30)
        except requests.RequestException:
            continue
        if q.status_code >= 500:
            continue
        q.raise_for_status()
        data = (q.json() or {}).get("data") or {}
        state = str(data.get("state") or "")
        if state == "success":
            urls = json.loads(data.get("resultJson") or "{}").get("resultUrls") or []
            if not urls:
                raise RuntimeError("kie remover finished without a picture")
            got = requests.get(urls[0], timeout=120)
            got.raise_for_status()
            Path(dest).parent.mkdir(parents=True, exist_ok=True)
            Path(dest).write_bytes(got.content)
            return Path(dest)
        if state == "fail":
            raise RuntimeError(f"kie remover failed: {data.get('failMsg') or data.get('failCode')}")
    raise TimeoutError(f"kie remover task {task} did not finish in {timeout_s}s")


def remove(src: Path, dest: Path, log=print, label: str = "cutout", cache_file: Path = None) -> Path:
    """dest from src with the background removed — WaveSpeed while it has budget, kie.ai otherwise."""
    import wavespeed
    kie_first = _env("PHOTOFX_REMOVER").lower() == "kie" or not wavespeed.has_budget()
    order = ["kie", "wavespeed"] if kie_first else ["wavespeed", "kie"]
    last = None
    for who in order:
        try:
            if who == "wavespeed":
                if not _env("WAVESPEED_API_KEY"):
                    continue
                wavespeed.run(WAVESPEED_MODEL if "/" in WAVESPEED_MODEL else "wavespeed-ai/image-background-remover",
                              {"image": wavespeed.upload(Path(src), cache_file)}, Path(dest), label=label, log=log)
            else:
                if not _env("KIE_API_KEY"):
                    continue
                kie_remove(Path(src), Path(dest), log)
            return Path(dest)
        except Exception as e:                                   # noqa: BLE001 - the other service may still do it
            last = e
            log(f"  {label}: the {who} background remover could not do it — {str(e)[:100]}")
    raise last or RuntimeError("no background remover: add WAVESPEED_API_KEY or KIE_API_KEY")


def host(path: Path, cache_file: Path = None) -> str:
    """A public link for a local picture (a reference for an image model): WaveSpeed's hosting, kie.ai's otherwise."""
    last = None
    if _env("WAVESPEED_API_KEY"):
        try:
            import wavespeed
            return wavespeed.upload(Path(path), cache_file)
        except Exception as e:                                   # noqa: BLE001
            last = e
    if _env("KIE_API_KEY"):
        small = _small_jpeg(Path(path))
        try:
            return kie_upload(small)
        finally:
            small.unlink(missing_ok=True)
    raise last or RuntimeError("no picture hosting: add WAVESPEED_API_KEY or KIE_API_KEY")
