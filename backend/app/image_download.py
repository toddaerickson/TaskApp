"""SSRF-safe image downloader for the R2 upload pipeline (PR-A2b).

Used by `exercise_routes.add_image` when R2 is configured. Validates
the URL host doesn't resolve to a private network, caps bytes, sniffs
content-type, hashes content. Returns bytes + content-type + sha256
so the caller can name the R2 object key by content hash.

Stdlib-only — no new deps.

Threat model: operator-pasted URLs from the admin UI's Pixabay / DDG /
Wikimedia search. The threat is a leaked admin token used to coerce
the backend into fetching internal-network URLs (SSRF) or arbitrarily
large files (DoS). Defense is a hostname → IP resolution check with
private-range blocking + a hard byte cap + a no-redirect policy
(redirect-following is the canonical SSRF bypass).
"""
from __future__ import annotations

import hashlib
import ipaddress
import logging
import socket
import urllib.parse
import urllib.request
from dataclasses import dataclass

log = logging.getLogger(__name__)

MAX_BYTES = 5 * 1024 * 1024  # 5 MB. Larger than any sane exercise image.
DOWNLOAD_TIMEOUT_SEC = 10


class DownloadError(Exception):
    """Raised when the download fails for any safety / IO reason. The
    route catches this and returns 422 (bad URL) so the admin sees a
    clear error in the UI instead of a 500."""


@dataclass(frozen=True)
class DownloadedImage:
    bytes_: bytes
    content_type: str
    sha256: str

    @property
    def extension(self) -> str:
        """Map content-type to file extension. Falls back to .bin if
        the type is exotic — the bytes are still uploadable to R2,
        just with an unusual key."""
        return _CONTENT_TYPE_EXT.get(self.content_type, ".bin")


_CONTENT_TYPE_EXT = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/svg+xml": ".svg",
}


class _NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Refuse all 3xx responses. Following redirects opens a SSRF
    window — a public URL can 302 to an internal IP and the urllib
    default handler doesn't re-validate the new host. Operator-friendly
    enough: most legitimate image URLs return 200 directly; a redirect
    chain is rare and re-pasting the resolved URL is one click."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise DownloadError(f"Refusing to follow {code} redirect to {newurl}")


_OPENER = urllib.request.build_opener(_NoRedirectHandler())


def _is_safe_host(host: str) -> bool:
    """Resolve `host` and confirm every returned IP is public.

    Rejects: loopback (127.x, ::1), private (RFC1918 / fc00::/7),
    link-local (169.254.x, fe80::/10), multicast.

    DNS rebinding is partially mitigated — we resolve once here and
    rely on urllib's own resolution at request time. A determined
    attacker could return different IPs to the two lookups, but the
    threat model is operator-pasted URLs not arbitrary user input,
    so the partial mitigation is acceptable for now.
    """
    try:
        addrs = socket.getaddrinfo(host, None)
    except socket.gaierror:
        return False
    for _, _, _, _, sockaddr in addrs:
        ip_str = sockaddr[0]
        try:
            ip = ipaddress.ip_address(ip_str)
        except ValueError:
            return False
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast:
            return False
    return True


def download_image(url: str) -> DownloadedImage:
    """Fetch the image at `url`. Validates scheme + host + content-type
    + size, hashes content. Raises `DownloadError` on any unsafe or
    unusable response."""
    parts = urllib.parse.urlsplit(url)
    if parts.scheme != "https":
        raise DownloadError(f"Only https URLs accepted (got {parts.scheme!r})")
    host = parts.hostname
    if not host:
        raise DownloadError("URL has no host")
    if not _is_safe_host(host):
        raise DownloadError(f"Host {host} resolves to a non-public IP")

    req = urllib.request.Request(
        url,
        headers={"User-Agent": "TaskApp/1.0 (+image-import)"},
    )
    try:
        with _OPENER.open(req, timeout=DOWNLOAD_TIMEOUT_SEC) as resp:
            content_type = (
                resp.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
            )
            if not content_type.startswith("image/"):
                raise DownloadError(
                    f"Content-Type {content_type!r} is not an image"
                )
            length_hdr = resp.headers.get("Content-Length")
            if length_hdr:
                try:
                    declared = int(length_hdr)
                except ValueError:
                    declared = None
                if declared is not None and declared > MAX_BYTES:
                    raise DownloadError(
                        f"Content-Length {declared} exceeds {MAX_BYTES}-byte cap"
                    )
            # Read one byte past the cap so we can detect overruns even
            # when Content-Length is absent or wrong.
            content = resp.read(MAX_BYTES + 1)
            if len(content) > MAX_BYTES:
                raise DownloadError(f"Body exceeds {MAX_BYTES}-byte cap")
    except DownloadError:
        raise
    except Exception as e:
        raise DownloadError(f"Download failed: {e}") from e

    return DownloadedImage(
        bytes_=content,
        content_type=content_type,
        sha256=hashlib.sha256(content).hexdigest(),
    )
