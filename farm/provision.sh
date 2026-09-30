#!/usr/bin/env bash
# farm/provision.sh — turn a bare Linux box into a machine that can render.
#
# Runs once, on a freshly rented pod, before farm/runner.py. Takes four to eight
# minutes on a stock python image, which at community-cloud prices is under two
# cents — cheap enough that most people never need to build an image. If you are
# rendering every day, build the Dockerfile next to this file instead and set
# FARM_IMAGE to it: the pod then starts in about a minute and skips all of this.
#
# Every step is quiet unless it fails, because this output is the top of the log
# you read when something goes wrong.
set -euo pipefail

say() { echo "=== provision: $* ==="; }

# A pod started from the farm/Dockerfile image already has all of this. Checking
# costs a millisecond and saves rewriting the boot path for the two cases.
if command -v ffmpeg >/dev/null 2>&1 \
   && python -c "import playwright, faster_whisper, requests" >/dev/null 2>&1; then
    say "already installed (prebuilt image) — skipping"
    exit 0
fi

say "system packages (ffmpeg, node for yt-dlp, fonts)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
# nodejs: YouTube hands over the good formats only to a client that can run its
# JavaScript, and without it yt-dlp is left with 360p or nothing.
# fonts-liberation + fonts-dejavu: Chromium needs *some* system font to fall back
# on. Frontier's own type is bundled and embedded, diacritics included.
apt-get install -y -qq --no-install-recommends \
    ffmpeg curl unzip ca-certificates nodejs fonts-liberation fonts-dejavu-core \
    >/dev/null

say "python packages"
pip install --no-cache-dir --disable-pip-version-check -q -r requirements.txt

say "chromium for the motion graphics"
# --with-deps pulls the ~40 shared libraries headless Chromium needs; without it
# the browser fails to start and every graphic in the video is silently missing.
python -m playwright install --with-deps chromium >/dev/null

say "warming the subtitle model"
# Downloaded now rather than mid-render: it is the same 150 MB either way, but
# here a failure is a clear line in the log instead of a puzzling one an hour in.
python - <<'PY' || echo "    (whisper model not cached — the render will fetch it itself)"
import os
from faster_whisper import WhisperModel
WhisperModel(os.environ.get("WHISPER_MODEL", "base"), device="cpu", compute_type="int8")
PY

say "ready — ffmpeg $(ffmpeg -version | head -1 | cut -d' ' -f3), node $(node --version)"
