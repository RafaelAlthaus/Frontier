"""farm/s3.py — the bucket your finished videos land in.

Cloudflare R2, Backblaze B2, Wasabi, plain AWS S3: all of them speak the same
S3 API, so this one small client talks to whichever you point it at. R2 is the
default because it charges nothing to download your own videos back out.

Signing is done here by hand rather than with boto3. boto3 pulls in ~100 MB of
botocore for four operations (put, get, list, delete), and Frontier's promise is
that `pip install -r requirements.txt` is short. The signing is AWS Signature
Version 4, and `tools/check_sigv4.py` checks this implementation against
botocore's on the official AWS test vectors — run it if you ever touch this file.
"""

from __future__ import annotations

import datetime as _dt
import hashlib
import hmac
import os
import urllib.parse
from pathlib import Path
from xml.etree import ElementTree

import requests

EMPTY_SHA256 = hashlib.sha256(b"").hexdigest()
_CHUNK = 1024 * 1024


class S3Error(RuntimeError):
    """A bucket refused something. The message carries the provider's own words."""


def _quote(s: str, safe: str = "/") -> str:
    """S3 canonical URI encoding: RFC 3986, and a slash stays a slash in a key."""
    return urllib.parse.quote(s, safe="-_.~" + safe)


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for block in iter(lambda: fh.read(_CHUNK), b""):
            h.update(block)
    return h.hexdigest()


def _sign(key: bytes, msg: str) -> bytes:
    return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()


class Bucket:
    """One bucket, four verbs.

    `endpoint` is the S3 endpoint without the bucket name
    (R2: https://<account id>.r2.cloudflarestorage.com). Keys are plain paths
    like "jobs/my-video.json" — no leading slash.
    """

    def __init__(self, endpoint: str, bucket: str, key_id: str, secret: str,
                 region: str = "auto", session: requests.Session | None = None):
        self.endpoint = (endpoint or "").rstrip("/")
        self.bucket = bucket
        self.key_id = key_id
        self.secret = secret
        self.region = region or "auto"
        self.http = session or requests.Session()
        if not (self.endpoint and bucket and key_id and secret):
            raise S3Error("bucket is not configured — endpoint, name, key id and secret are all needed")

    # ── signing ────────────────────────────────────────────────────────────

    def _auth_headers(self, method: str, key: str, query: dict, payload_sha: str,
                      extra: dict | None = None, length: int | None = None,
                      amz_date: str = "") -> dict:
        """Every header the request needs, Authorization included.

        Kept in one place because SigV4 only works if the headers you sign are
        byte-for-byte the headers you send — building them in two places is how
        this breaks. `amz_date` is only ever passed by the signature test, which
        has to sign the same instant twice to compare.
        """
        amz_date = amz_date or _dt.datetime.now(_dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        datestamp = amz_date[:8]
        host = urllib.parse.urlsplit(self.endpoint).netloc

        headers = {"host": host, "x-amz-content-sha256": payload_sha, "x-amz-date": amz_date}
        for k, v in (extra or {}).items():
            headers[k.lower()] = str(v)
        if length is not None:
            headers["content-length"] = str(length)

        signed_names = sorted(headers)
        canonical_headers = "".join(f"{n}:{str(headers[n]).strip()}\n" for n in signed_names)
        signed_headers = ";".join(signed_names)

        canonical_qs = "&".join(
            f"{_quote(k, '')}={_quote(str(v), '')}" for k, v in sorted(query.items()))
        canonical_uri = "/" + _quote(f"{self.bucket}/{key}".rstrip("/")) if key else "/" + _quote(self.bucket)

        canonical_request = "\n".join(
            [method, canonical_uri, canonical_qs, canonical_headers, signed_headers, payload_sha])
        scope = f"{datestamp}/{self.region}/s3/aws4_request"
        to_sign = "\n".join(["AWS4-HMAC-SHA256", amz_date, scope,
                             hashlib.sha256(canonical_request.encode("utf-8")).hexdigest()])

        k_date = _sign(("AWS4" + self.secret).encode("utf-8"), datestamp)
        k_region = _sign(k_date, self.region)
        k_service = _sign(k_region, "s3")
        k_signing = _sign(k_service, "aws4_request")
        signature = hmac.new(k_signing, to_sign.encode("utf-8"), hashlib.sha256).hexdigest()

        headers["Authorization"] = (
            f"AWS4-HMAC-SHA256 Credential={self.key_id}/{scope}, "
            f"SignedHeaders={signed_headers}, Signature={signature}")
        return headers

    def _url(self, key: str, query: dict | None = None) -> str:
        path = _quote(f"{self.bucket}/{key}".rstrip("/")) if key else _quote(self.bucket)
        url = f"{self.endpoint}/{path}"
        if query:
            url += "?" + "&".join(f"{_quote(k, '')}={_quote(str(v), '')}" for k, v in sorted(query.items()))
        return url

    def _request(self, method: str, key: str, *, query: dict | None = None,
                 body=None, payload_sha: str = EMPTY_SHA256, extra: dict | None = None,
                 length: int | None = None, stream: bool = False, timeout: int = 60):
        query = query or {}
        headers = self._auth_headers(method, key, query, payload_sha, extra, length)
        headers.pop("host", None)          # requests sets Host itself, identically
        r = self.http.request(method, self._url(key, query), headers=headers, data=body,
                              stream=stream, timeout=timeout)
        if r.status_code >= 400:
            detail = (r.text or "")[:400].replace("\n", " ")
            raise S3Error(f"{method} {key or '/'} -> HTTP {r.status_code}: {detail}")
        return r

    def presign(self, key: str, seconds: int = 6 * 3600, method: str = "GET") -> str:
        """A plain https link to one object that works for `seconds`, then stops.

        This is how a brand-new pod gets Frontier's code: it has curl and nothing
        else, and handing it a signed link beats teaching a bootstrap script to
        sign. The signature travels in the query string (SigV4 "presigned"),
        which needs the payload hash set to UNSIGNED-PAYLOAD and the headers
        reduced to `host` alone — no other header is sent, so no other header can
        be signed.
        """
        now = _dt.datetime.now(_dt.timezone.utc)
        amz_date = now.strftime("%Y%m%dT%H%M%SZ")
        datestamp = amz_date[:8]
        host = urllib.parse.urlsplit(self.endpoint).netloc
        scope = f"{datestamp}/{self.region}/s3/aws4_request"

        query = {"X-Amz-Algorithm": "AWS4-HMAC-SHA256",
                 "X-Amz-Credential": f"{self.key_id}/{scope}",
                 "X-Amz-Date": amz_date,
                 "X-Amz-Expires": str(int(seconds)),
                 "X-Amz-SignedHeaders": "host"}
        canonical_qs = "&".join(f"{_quote(k, '')}={_quote(str(v), '')}"
                                for k, v in sorted(query.items()))
        canonical_uri = "/" + _quote(f"{self.bucket}/{key}".rstrip("/"))
        canonical_request = "\n".join(
            [method, canonical_uri, canonical_qs, f"host:{host}\n", "host", "UNSIGNED-PAYLOAD"])
        to_sign = "\n".join(["AWS4-HMAC-SHA256", amz_date, scope,
                             hashlib.sha256(canonical_request.encode("utf-8")).hexdigest()])

        k_date = _sign(("AWS4" + self.secret).encode("utf-8"), datestamp)
        k_signing = _sign(_sign(_sign(k_date, self.region), "s3"), "aws4_request")
        signature = hmac.new(k_signing, to_sign.encode("utf-8"), hashlib.sha256).hexdigest()
        return f"{self.endpoint}{canonical_uri}?{canonical_qs}&X-Amz-Signature={signature}"

    # ── the four verbs ─────────────────────────────────────────────────────

    def put_bytes(self, key: str, data: bytes, content_type: str = "application/octet-stream") -> None:
        self._request("PUT", key, body=data, payload_sha=hashlib.sha256(data).hexdigest(),
                      extra={"content-type": content_type}, length=len(data))

    def put_file(self, key: str, path, content_type: str | None = None, timeout: int = 1800) -> int:
        """Upload a file by streaming it — a finished video never sits in memory.

        The hash pass reads the file a second time, which costs about a second
        per gigabyte and buys a signature every S3 implementation accepts;
        UNSIGNED-PAYLOAD is lighter but not universally allowed on PUT.
        """
        path = Path(path)
        size = path.stat().st_size
        if size > 4 * 1024 ** 3:
            raise S3Error(f"{path.name} is {size / 1024 ** 3:.1f} GB — over the 4 GB single-PUT limit")
        ctype = content_type or _guess_type(path.name)
        with path.open("rb") as fh:
            self._request("PUT", key, body=fh, payload_sha=_sha256_file(path),
                          extra={"content-type": ctype}, length=size, timeout=timeout)
        return size

    def get_bytes(self, key: str) -> bytes:
        return self._request("GET", key).content

    def get_file(self, key: str, path, timeout: int = 1800) -> int:
        """Download to disk through a temp file, so a half-finished download is
        never mistaken for the real thing."""
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(path.suffix + ".part")
        got = 0
        r = self._request("GET", key, stream=True, timeout=timeout)
        with tmp.open("wb") as fh:
            for block in r.iter_content(_CHUNK):
                fh.write(block)
                got += len(block)
        tmp.replace(path)
        return got

    def exists(self, key: str) -> bool:
        try:
            self._request("HEAD", key)
            return True
        except S3Error:
            return False

    def delete(self, key: str) -> None:
        self._request("DELETE", key)

    def list(self, prefix: str = "") -> list:
        """Every object under `prefix`, following continuation tokens."""
        out, token = [], None
        ns = "{http://s3.amazonaws.com/doc/2006-03-01/}"
        while True:
            query = {"list-type": "2", "prefix": prefix}
            if token:
                query["continuation-token"] = token
            root = ElementTree.fromstring(self._request("GET", "", query=query).content)
            for node in root.findall(f"{ns}Contents"):
                out.append({"key": node.findtext(f"{ns}Key") or "",
                            "size": int(node.findtext(f"{ns}Size") or 0),
                            "modified": node.findtext(f"{ns}LastModified") or ""})
            if (root.findtext(f"{ns}IsTruncated") or "").lower() != "true":
                return out
            token = root.findtext(f"{ns}NextContinuationToken")
            if not token:
                return out


_TYPES = {".mp4": "video/mp4", ".mov": "video/quicktime", ".png": "image/png",
          ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".json": "application/json",
          ".txt": "text/plain; charset=utf-8", ".srt": "text/plain; charset=utf-8",
          ".md": "text/markdown; charset=utf-8", ".log": "text/plain; charset=utf-8"}


def _guess_type(name: str) -> str:
    return _TYPES.get(os.path.splitext(name)[1].lower(), "application/octet-stream")
