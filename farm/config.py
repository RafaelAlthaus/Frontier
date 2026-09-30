"""farm/config.py — everything the render farm reads out of your .env.

Two machines, two halves. Your Mac needs the RunPod key and the bucket, so it
can rent a machine and fetch the result. The pod needs the render keys — voice,
pictures, footage — and nothing else: it never sees your RunPod account beyond
the one token it uses to switch itself off.
"""

from __future__ import annotations

import os
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent

# The keys the pod has to have to render, copied from your .env into the pod's
# environment when it is created. RunPod stores these encrypted; they are not in
# the image and not in the bucket.
RENDER_KEYS = (
    "ALGROW_API_KEY", "WAVESPEED_API_KEY", "KIE_API_KEY", "GEMINI_API_KEY",
    "PEXELS_API_KEY", "AI33_API_KEY", "AI33_VOICE_ID", "ANTHROPIC_API_KEY",
    "ALGROW_VOICE_ID", "ALGROW_TTS_MODEL", "ALGROW_IMAGE_MODEL",
    "WAVESPEED_VOICE", "WAVESPEED_IMAGE_MODEL", "VOICE_PROVIDER", "IMAGE_PROVIDER",
    "CLAUDE_SCRIPT_MODEL", "CLAUDE_SCRIPT_BODY_MODEL", "CLAUDE_UTILITY_MODEL",
    "KIE_IMAGE_MODEL", "GEMINI_MODEL", "WHISPER_MODEL",
    "VIDEO_W", "VIDEO_H", "FPS", "NUM_AI_IMAGES", "FOOTAGE_GRADE",
    "YT_SLEEP", "YT_WORKERS", "YTDLP_PLAYER_CLIENT", "YTDLP_ARGS", "YTDLP_PROXY",
    "AI_IMG_WORKERS", "DL_WORKERS", "RENDER_WORKERS", "FFMPEG_THREADS",
    # a relay for the Claude calls (CLAUDE_RELAY=openlux), the image service and the footage watcher it also serves,
    # and the music/sound-effects library a job's own sound design may be drawn from
    "CLAUDE_RELAY", "OPENLUX_API_KEY", "OPENLUX_BASE_URL", "OPENLUX_MODEL", "SIRAY_API_KEY", "EPIDEMIC_API_KEY",
)

# Sensible on a rented Linux box and wrong on your Mac, so they are set on the
# pod rather than copied. `claudecode` is the big one: the pod has no Claude Code
# login, and without this every Claude call would spend 30s discovering that
# before falling back. The scripts are written on your Mac before the pod exists.
POD_FORCED = {
    "CLAUDE_PROVIDER": "anthropic",
    "SCRIPT_PROVIDER": "anthropic",
    "CLAUDE_FALLBACK": "",
    "PYTHONUNBUFFERED": "1",
    "DEBIAN_FRONTEND": "noninteractive",
}


def _env(name: str, default: str = "") -> str:
    return (os.environ.get(name) or default).strip()


def _int(name: str, default: int) -> int:
    try:
        return int(_env(name) or default)
    except ValueError:
        return default


class Config:
    """Read once, complain clearly. `farm.py check` prints what is missing."""

    def __init__(self):
        self.runpod_key = _env("RUNPOD_API_KEY")

        # ── the bucket ──
        self.bucket_endpoint = _env("FARM_BUCKET_ENDPOINT")
        self.bucket = _env("FARM_BUCKET")
        self.bucket_key_id = _env("FARM_BUCKET_KEY_ID")
        self.bucket_secret = _env("FARM_BUCKET_SECRET")
        self.bucket_region = _env("FARM_BUCKET_REGION", "auto")

        # ── the machine ──
        # An A4000 is rented for its processors, not its graphics card: nothing in
        # Frontier touches CUDA (Chromium runs --disable-gpu, ffmpeg uses libx264),
        # but on RunPod a cheap GPU pod is the least expensive way to get 8+ cores.
        self.gpu = _env("FARM_GPU", "NVIDIA RTX A4000")
        self.cpu_flavour = _env("FARM_CPU")          # set this instead to use a CPU-only pod
        self.vcpu = _int("FARM_VCPU", 8)
        self.min_ram = _int("FARM_MIN_RAM", 24)
        self.cloud = _env("FARM_CLOUD", "COMMUNITY").upper()
        self.disk_gb = _int("FARM_DISK_GB", 150)
        self.image = _env("FARM_IMAGE", "python:3.11-slim-bookworm")
        self.datacenters = [d for d in _env("FARM_DATACENTERS").replace(",", " ").split() if d]

        # ── the safety rails ──
        # Every one of these exists because the only way this gets expensive is a
        # pod that finishes, or dies, and stays switched on.
        self.max_minutes = _int("FARM_MAX_MINUTES", 240)
        self.max_pods = _int("FARM_MAX_PODS", 5)
        self.budget_usd = float(_env("FARM_BUDGET_USD", "10") or 10)

        self.prefix = _env("FARM_PREFIX", "frontier")

    # ── what is missing ────────────────────────────────────────────────────

    def checklist(self) -> list:
        """Every piece cloud rendering needs, and whether it is there.

        A list rather than a sentence, because "Missing: RUNPOD_API_KEY,
        FARM_BUCKET_ENDPOINT, FARM_BUCKET, FARM_BUCKET_KEY_ID, FARM_BUCKET_SECRET"
        tells somebody who has never set this up nothing about what to go and do.
        """
        return [
            {"key": "runpod", "label": "RunPod account",
             "ok": bool(self.runpod_key), "env": "RUNPOD_API_KEY",
             "how": "runpod.io → Settings → API Keys → Create (permission: All), "
                    "and put $10 of credit on the account"},
            {"key": "bucket", "label": "A bucket for the finished videos",
             "ok": bool(self.bucket_endpoint and self.bucket
                        and self.bucket_key_id and self.bucket_secret),
             "env": "FARM_BUCKET_ENDPOINT, FARM_BUCKET, FARM_BUCKET_KEY_ID, FARM_BUCKET_SECRET",
             "how": "Cloudflare R2 → Create bucket → Manage API Tokens → Object Read & Write. "
                    "R2 charges nothing to download your own videos back"},
            {"key": "claude", "label": "A Claude key for the machine",
             "ok": bool(_env("ANTHROPIC_API_KEY") or _env("KIE_API_KEY")),
             "env": "ANTHROPIC_API_KEY",
             "how": "console.anthropic.com → API Keys. A rented machine has no Claude Code "
                    "login, so the calls it makes have to be bought"},
            {"key": "render", "label": "A voice and a picture service",
             "ok": bool(_env("ALGROW_API_KEY") or _env("WAVESPEED_API_KEY") or _env("AI33_API_KEY")),
             "env": "ALGROW_API_KEY or WAVESPEED_API_KEY",
             "how": "the same keys you already render with locally"},
        ]


    def missing_for_mac(self) -> list:
        want = {"RUNPOD_API_KEY": self.runpod_key,
                "FARM_BUCKET_ENDPOINT": self.bucket_endpoint,
                "FARM_BUCKET": self.bucket,
                "FARM_BUCKET_KEY_ID": self.bucket_key_id,
                "FARM_BUCKET_SECRET": self.bucket_secret}
        return [k for k, v in want.items() if not v]

    def missing_for_render(self) -> list:
        """Keys a pod needs that your .env has not got. A voice and a picture
        service are the floor; without Anthropic the pod cannot direct an edit."""
        out = []
        if not _env("ANTHROPIC_API_KEY") and not _env("KIE_API_KEY"):
            out.append("ANTHROPIC_API_KEY (or KIE_API_KEY) — the pod has no Claude Code to fall back on")
        if not any(_env(k) for k in ("ALGROW_API_KEY", "WAVESPEED_API_KEY", "AI33_API_KEY")):
            out.append("ALGROW_API_KEY or WAVESPEED_API_KEY — nothing can speak the narration")
        return out

    def pod_env(self, job_key: str, extra: dict | None = None) -> dict:
        """The environment one pod is created with."""
        env = {k: os.environ[k] for k in RENDER_KEYS if _env(k)}
        env.update(POD_FORCED)
        env.update({
            "FARM_JOB_KEY": job_key,
            "FARM_BUCKET_ENDPOINT": self.bucket_endpoint,
            "FARM_BUCKET": self.bucket,
            "FARM_BUCKET_KEY_ID": self.bucket_key_id,
            "FARM_BUCKET_SECRET": self.bucket_secret,
            "FARM_BUCKET_REGION": self.bucket_region,
            "FARM_MAX_MINUTES": str(self.max_minutes),
            "RUNPOD_API_KEY": self.runpod_key,      # so it can switch itself off
        })
        # Algrow answers 30 requests a minute and the engine draws pictures ten at
        # a time, which on a pod means a wall of 429s and minutes of backoff paid
        # for by the hour. Four keeps it under the limit; set AI_IMG_WORKERS in
        # .env if your service is happier with more.
        env.setdefault("AI_IMG_WORKERS", "4")
        env.update(extra or {})
        return env


def bucket_from(cfg: Config):
    from farm.s3 import Bucket
    return Bucket(cfg.bucket_endpoint, cfg.bucket, cfg.bucket_key_id,
                  cfg.bucket_secret, cfg.bucket_region)


def load_env() -> None:
    """Read Frontier's .env, the same file the app itself reads."""
    try:
        from dotenv import load_dotenv
        load_dotenv(HERE / ".env", override=True)
    except ImportError:
        pass
