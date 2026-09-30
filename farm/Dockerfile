# Frontier render pod — optional.
#
# You do not need this. By default a pod starts from a stock Python image and
# installs what it needs in four to eight minutes, which costs under two cents.
# Build this instead once that wait annoys you: it is the same software, already
# installed, so a pod is rendering about a minute after you rent it.
#
#   docker build --platform linux/amd64 -t <you>/frontier-render:1 -f farm/Dockerfile .
#   docker push  <you>/frontier-render:1
#   FARM_IMAGE=<you>/frontier-render:1      # in your .env
#
# --platform linux/amd64 is not optional on an Apple Silicon Mac: RunPod machines
# are x86, and an arm64 image starts and then fails on the first binary it runs.
# Building it under emulation is slow — once, in the background, is the idea.
#
# The code is NOT baked in. Frontier still arrives from your bucket at boot, so
# editing a style file does not mean rebuilding and pushing a gigabyte.

FROM python:3.11-slim-bookworm

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PLAYWRIGHT_BROWSERS_PATH=/opt/pw

# ffmpeg renders; node is what YouTube demands before it hands yt-dlp anything
# better than 360p; the fonts are Chromium's fallback, Frontier's own type being
# bundled and embedded.
RUN apt-get update -qq \
 && apt-get install -y -qq --no-install-recommends \
      ffmpeg curl unzip ca-certificates nodejs fonts-liberation fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt \
 && python -m playwright install --with-deps chromium

# The subtitle model, downloaded now so no render pays for it.
ENV WHISPER_MODEL=base
RUN python -c "from faster_whisper import WhisperModel; \
WhisperModel('base', device='cpu', compute_type='int8')"

WORKDIR /frontier
CMD ["python", "-u", "-m", "farm.runner"]
