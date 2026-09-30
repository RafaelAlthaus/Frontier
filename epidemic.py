#!/usr/bin/env python3
"""epidemic.py — Epidemic Sound's catalogue: sound effects and music, searched and downloaded.

The key in .env (EPIDEMIC_API_KEY, "epidemic_live_…") is refused by the Partner Content REST
API (401 on every endpoint, with every documented header) but accepted by Epidemic's MCP
service — the same catalogue behind a JSON-RPC door. That door is what this module talks to:
initialize once, then tools/call SearchSoundEffects / DownloadSoundEffect / SearchRecordings /
DownloadRecording / EditRecording. Every answer is a GraphQL result wrapped in an MCP text part.

What is downloaded is licensed to the key's owner for their own videos. It is kept under
assets/sfx/es/ and assets/music/ folders that .shipignore keeps on this machine: a buyer brings
their own key (or gets the synthesised sounds).

    search_sfx(term, n, max_ms)        -> [{id, title, ms, preview, tags}]
    download_sfx(id, dest, fmt)        -> dest
    search_music(term, n, **filters)   -> [{id, title, bpm, ms, preview, tags, artists}]
    download_music(id, dest, fmt)      -> dest
    edit_music(id, ms, dest)           -> a version cut to exactly ms, with a real ending

    python epidemic.py sfx "camera shutter" [-n 10]
    python epidemic.py music "technology news" [-n 10]
    python epidemic.py get-sfx <id> <dest.wav>
"""
import json
import os
import sys
import time
from pathlib import Path

import requests

HERE = Path(__file__).resolve().parent
URL = "https://www.epidemicsound.com/a/mcp-service/mcp"
_SESSION = {}


def _key() -> str:
    k = (os.environ.get("EPIDEMIC_API_KEY") or "").strip()
    if not k and (HERE / ".env").exists():
        for line in (HERE / ".env").read_text(encoding="utf-8").splitlines():
            if line.strip().startswith("EPIDEMIC_API_KEY="):
                k = line.split("=", 1)[1].strip().strip("'\"")
    if not k:
        raise RuntimeError("EPIDEMIC_API_KEY missing from .env")
    return k


def _headers(sid: str = "") -> dict:
    h = {"Authorization": f"Bearer {_key()}", "Content-Type": "application/json",
         "Accept": "application/json, text/event-stream"}
    if sid:
        h["Mcp-Session-Id"] = sid
    return h


def _parse(r) -> dict:
    """An MCP answer is JSON, or a server-sent event stream whose last data line is the JSON."""
    txt = r.text
    if "data:" in txt:
        rows = [ln[5:].strip() for ln in txt.splitlines() if ln.startswith("data:") and ln[5:].strip()]
        txt = rows[-1] if rows else "{}"
    return json.loads(txt or "{}")


def _session() -> str:
    if _SESSION.get("id") and time.time() - _SESSION.get("t", 0) < 600:
        return _SESSION["id"]
    r = requests.post(URL, headers=_headers(), timeout=60, json={
        "jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": {"protocolVersion": "2025-06-18", "capabilities": {},
                   "clientInfo": {"name": "frontier", "version": "1.0"}}})
    if r.status_code != 200:
        raise RuntimeError(f"epidemic: HTTP {r.status_code} on initialize — {r.text[:160]}")
    sid = r.headers.get("mcp-session-id") or ""
    requests.post(URL, headers=_headers(sid), timeout=60,
                  json={"jsonrpc": "2.0", "method": "notifications/initialized"})
    _SESSION.update(id=sid, t=time.time())
    return sid


def call(tool: str, args: dict) -> dict:
    """One tool call -> its GraphQL data (a dict). Raises with the service's own words on an error."""
    last = None
    for attempt in range(3):
        try:
            r = requests.post(URL, headers=_headers(_session()), timeout=120, json={
                "jsonrpc": "2.0", "id": int(time.time() * 1000) % 10**9, "method": "tools/call",
                "params": {"name": tool, "arguments": args}})
            d = _parse(r)
        except (requests.RequestException, ValueError) as e:
            last = e
            _SESSION.clear()
            time.sleep(2 * (attempt + 1))
            continue
        if "error" in d:
            last = RuntimeError(f"epidemic {tool}: {str(d['error'])[:200]}")
            _SESSION.clear()
            time.sleep(2 * (attempt + 1))
            continue
        res = d.get("result") or {}
        text = "".join(p.get("text", "") for p in res.get("content") or [] if p.get("type") == "text")
        if res.get("isError"):
            raise RuntimeError(f"epidemic {tool}: {text[:240]}")
        try:
            out = json.loads(text)
        except ValueError:
            raise RuntimeError(f"epidemic {tool}: not JSON — {text[:200]}")
        return out.get("data", out) if isinstance(out, dict) else out
    raise last or RuntimeError(f"epidemic {tool}: no answer")


def _first(d: dict, *path):
    for p in path:
        if isinstance(d, dict):
            d = d.get(p)
    return d


def _nodes(data: dict) -> list:
    """The nodes of the one connection a search returns, whatever the query's field is called."""
    conn = next((v for v in data.values() if isinstance(v, dict) and "nodes" in v), None) if isinstance(data, dict) else None
    return (conn or {}).get("nodes") or []


def search_sfx(term: str, n: int = 10, max_ms: int = 0, min_ms: int = 0, sort: str = "RELEVANCE") -> list:
    args = {"query": {"term": term}, "first": int(n), "sort": {"by": sort, "order": "DESCENDING"}}
    if max_ms or min_ms:
        args["filter"] = {"duration": {k: v for k, v in (("min", min_ms), ("max", max_ms)) if v}}
    out = []
    for node in _nodes(call("SearchSoundEffects", args)):
        s = node.get("soundEffect") or node
        af = s.get("audioFile") or {}
        out.append({"id": s.get("id"), "title": s.get("title"), "ms": af.get("durationInMilliseconds"),
                    "preview": af.get("lqmp3Url"), "tags": [t.get("slug") or t.get("displayName") for t in s.get("tags") or []]})
    return out


def _fetch(url: str, dest: Path) -> Path:
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    r = requests.get(url, timeout=300)
    r.raise_for_status()
    tmp = dest.with_suffix(dest.suffix + ".part")
    tmp.write_bytes(r.content)
    tmp.replace(dest)
    return dest


def download_sfx(sfx_id: str, dest, fmt: str = "WAV") -> Path:
    d = call("DownloadSoundEffect", {"id": sfx_id, "options": {"fileType": fmt.upper()}})
    url = _first(d, "soundEffectDownload", "assetUrl") or next(
        (v.get("assetUrl") for v in d.values() if isinstance(v, dict) and v.get("assetUrl")), None)
    if not url:
        raise RuntimeError(f"epidemic: no download for sound effect {sfx_id}: {str(d)[:160]}")
    return _fetch(url, dest)


def search_music(term: str = "", n: int = 10, topic: str = "", bpm=None, moods=None, tags=None,
                 not_tags=None, min_ms: int = 0, max_ms: int = 0, sort: str = "RELEVANCE") -> list:
    q = {"topic": topic} if topic else {"term": term}
    flt = {}
    if bpm:
        flt["bpm"] = {"min": int(bpm[0]), "max": int(bpm[1])}
    if min_ms or max_ms:
        flt["duration"] = {k: v for k, v in (("min", min_ms), ("max", max_ms)) if v}
    if moods:
        flt["moodSlugs"] = {"matchType": "ANY", "values": list(moods)}
    if tags:
        flt["tagSlugs"] = {"matchType": "ANY", "values": list(tags)}
    if not_tags:
        flt["tagSlugs"] = {"matchType": "NOT_ANY", "values": list(not_tags)}
    args = {"query": q, "first": int(n), "sort": {"by": sort, "order": "DESCENDING"}}
    if flt:
        args["filter"] = flt
    out = []
    for node in _nodes(call("SearchRecordings", args)):
        s = node.get("recording") or node
        af = s.get("audioFile") or {}
        out.append({"id": s.get("id"), "title": s.get("title"), "bpm": s.get("bpm"), "ms": af.get("durationInMilliseconds"),
                    "preview": af.get("lqmp3Url"), "tags": [t.get("displayName") for t in s.get("tags") or []],
                    "artists": [_first(c, "artist", "name") for c in s.get("credits") or [] if c.get("role") == "MAIN_ARTIST"]})
    return out


def download_music(rec_id: str, dest, fmt: str = "MP3", stem: str = "FULL") -> Path:
    d = call("DownloadRecording", {"id": rec_id, "options": {"fileType": fmt.upper(), "stemType": stem}})
    url = next((v.get("assetUrl") for v in d.values() if isinstance(v, dict) and v.get("assetUrl")), None)
    if not url:
        raise RuntimeError(f"epidemic: no download for recording {rec_id}: {str(d)[:160]}")
    return _fetch(url, dest)


def edit_music(rec_id: str, ms: int, dest, fmt: str = "MP3", timeout_s: int = 600) -> Path:
    """Epidemic's own edit of a track to exactly `ms` long — cut on its bars, with its real ending —
    so the music finishes with the video instead of being faded out mid-phrase."""
    job = call("EditRecording", {"id": rec_id, "input": {"targetDurationMs": int(ms), "downloadAudioFormat": fmt.upper(),
                                                        "skipStems": True, "maxResults": 1, "forceDuration": True}})
    jid = next((v.get("id") for v in job.values() if isinstance(v, dict) and v.get("id")), None)
    if not jid:
        raise RuntimeError(f"epidemic: the edit was not accepted: {str(job)[:200]}")
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        time.sleep(4)
        st = call("PollEditRecordingJob", {"id": jid})
        body = next((v for v in st.values() if isinstance(v, dict)), {})
        status = str(body.get("status") or "").upper()
        if status == "COMPLETED":
            edits = body.get("edits") or ([body["edit"]] if body.get("edit") else [])
            eid = (edits[0] or {}).get("id") if edits else None
            if not eid:
                raise RuntimeError(f"epidemic: the edit finished without a result: {str(body)[:200]}")
            d = call("DownloadRecordingEdit", {"input": {"jobId": jid, "editId": eid}})
            url = next((v.get("assetUrl") or v.get("url") for v in d.values() if isinstance(v, dict)
                        and (v.get("assetUrl") or v.get("url"))), None)
            if not url:
                raise RuntimeError(f"epidemic: no download for the edit: {str(d)[:200]}")
            return _fetch(url, dest)
        if status == "FAILED":
            raise RuntimeError(f"epidemic: the edit failed: {str(body)[:200]}")
    raise TimeoutError("epidemic: the edit was still not done")


if __name__ == "__main__":
    a = sys.argv[1:]
    if not a:
        print(__doc__)
        raise SystemExit(0)
    n = int(a[a.index("-n") + 1]) if "-n" in a else 10
    if a[0] == "sfx":
        for s in search_sfx(a[1], n):
            print(f"{s['id']}  {s['ms'] or 0:>6} ms  {s['title']}  [{', '.join(x for x in s['tags'][:6] if x)}]")
    elif a[0] == "music":
        for s in search_music(a[1], n):
            print(f"{s['id']}  {s['bpm']:>3} bpm  {(s['ms'] or 0) // 1000:>4} s  {s['title']} — {', '.join(x for x in s['artists'] if x)}"
                  f"  [{', '.join(x for x in s['tags'][:6] if x)}]")
    elif a[0] == "get-sfx":
        print(download_sfx(a[1], Path(a[2])))
    elif a[0] == "get-music":
        print(download_music(a[1], Path(a[2])))
