"""farm/state.py — the two memories that must outlive a pod.

`youtube_used.json` and `pexels_used.json` are why a clip is never used twice.
They live next to make_video.py and grow with every render — which is fine on
one computer and useless on a machine that is deleted the moment it finishes.

So the bucket holds the master copy, and no pod ever writes to it. A pod reads
the master when it starts and writes back only **what it added**, under its own
name. Your Mac folds those deltas into the master when you pull. Five pods can
finish at the same second and none of them can lose another's work, because
none of them share a file.

The honest limit: pods running *at the same time* cannot see each other's
choices, so two videos rendered side by side can pick the same clip. Across
batches — which is where repetition actually shows — it holds.
"""

from __future__ import annotations

import json
from pathlib import Path

from farm.s3 import S3Error

MASTER = {"youtube_used.json": "state/youtube_used.json",
          "pexels_used.json": "state/pexels_used.json"}
DELTAS = "state/deltas/"


def _read(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def merge(a, b):
    """Fold b into a. A dict of id -> list of spans, or a flat list of ids."""
    if isinstance(a, dict) and isinstance(b, dict):
        out = {k: list(v) for k, v in a.items()}
        for k, spans in b.items():
            seen = {json.dumps(s, sort_keys=True) for s in out.get(k, [])}
            out.setdefault(k, [])
            for s in spans:
                if json.dumps(s, sort_keys=True) not in seen:
                    seen.add(json.dumps(s, sort_keys=True))
                    out[k].append(s)
        return out
    if isinstance(a, list) and isinstance(b, list):
        out, seen = list(a), {json.dumps(x, sort_keys=True) for x in a}
        for x in b:
            if json.dumps(x, sort_keys=True) not in seen:
                seen.add(json.dumps(x, sort_keys=True))
                out.append(x)
        return out
    return b if a is None else a


def difference(before, after):
    """What `after` has that `before` did not — this pod's own contribution."""
    if isinstance(after, dict):
        before = before if isinstance(before, dict) else {}
        out = {}
        for k, spans in after.items():
            old = {json.dumps(s, sort_keys=True) for s in before.get(k, [])}
            new = [s for s in spans if json.dumps(s, sort_keys=True) not in old]
            if new:
                out[k] = new
        return out
    if isinstance(after, list):
        old = {json.dumps(x, sort_keys=True) for x in (before or [])}
        return [x for x in after if json.dumps(x, sort_keys=True) not in old]
    return after


def seed(bucket, root: Path) -> list:
    """Put this computer's footage memory in the bucket, if the bucket has none.

    Without it the first pod starts from nothing and can reuse a clip from a
    video you made months ago — the exact thing `youtube_used.json` exists to
    prevent. Only ever fills an empty slot: once the bucket has a master, the
    pods' own deltas are the truth and this must not stamp on them.
    """
    sent = []
    for name, key in MASTER.items():
        local = _read(root / name)
        if local is None:
            continue
        try:
            bucket.get_bytes(key)
            continue                    # the bucket already knows; leave it alone
        except S3Error:
            pass
        bucket.put_bytes(key, json.dumps(local).encode("utf-8"), "application/json")
        sent.append((name, len(local)))
    return sent


def pull(bucket, root: Path) -> dict:
    """Master + every delta written so far, onto this machine's disk.

    Returns what was loaded, so the pod can work out its own delta at the end.
    """
    loaded = {}
    deltas = []
    try:
        deltas = [o["key"] for o in bucket.list(DELTAS) if o["key"].endswith(".json")]
    except S3Error:
        pass
    for name, key in MASTER.items():
        data = None
        try:
            data = json.loads(bucket.get_bytes(key).decode("utf-8"))
        except (S3Error, ValueError, UnicodeDecodeError):
            pass
        for dkey in deltas:
            if not dkey.endswith(f".{name}"):
                continue
            try:
                data = merge(data, json.loads(bucket.get_bytes(dkey).decode("utf-8")))
            except (S3Error, ValueError, UnicodeDecodeError):
                continue
        if data is not None:
            (root / name).write_text(json.dumps(data), encoding="utf-8")
        loaded[name] = data
    return loaded


def push_delta(bucket, root: Path, before: dict, tag: str) -> list:
    """Upload only what this render added, named after the pod that added it."""
    sent = []
    for name in MASTER:
        after = _read(root / name)
        if after is None:
            continue
        delta = difference(before.get(name), after)
        if not delta:
            continue
        key = f"{DELTAS}{tag}.{name}"
        bucket.put_bytes(key, json.dumps(delta).encode("utf-8"), "application/json")
        sent.append(key)
    return sent


def fold_in(bucket, root: Path) -> dict:
    """On your Mac: master + all deltas -> master, deltas removed.

    The local files are written too, so the copy of Frontier on your own
    computer knows what the farm used and will not repeat it either.
    """
    counts = {}
    try:
        deltas = [o["key"] for o in bucket.list(DELTAS) if o["key"].endswith(".json")]
    except S3Error:
        return counts
    for name, key in MASTER.items():
        data = _read(root / name)
        try:
            data = merge(data, json.loads(bucket.get_bytes(key).decode("utf-8")))
        except (S3Error, ValueError, UnicodeDecodeError):
            pass
        used = []
        for dkey in deltas:
            if not dkey.endswith(f".{name}"):
                continue
            try:
                data = merge(data, json.loads(bucket.get_bytes(dkey).decode("utf-8")))
                used.append(dkey)
            except (S3Error, ValueError, UnicodeDecodeError):
                continue
        if data is None:
            continue
        blob = json.dumps(data)
        (root / name).write_text(blob, encoding="utf-8")
        bucket.put_bytes(key, blob.encode("utf-8"), "application/json")
        counts[name] = len(data)
        for dkey in used:                       # folded in, so no longer needed
            try:
                bucket.delete(dkey)
            except S3Error:
                pass
    return counts
