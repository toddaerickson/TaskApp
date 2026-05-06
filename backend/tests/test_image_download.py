"""Tests for the SSRF-safe image downloader (PR-A2b).

The threat model is "operator-pasted URL → server-side download" so the
key invariants are:

  1. Only https
  2. Hostname must resolve to a public IP (no loopback / private /
     link-local)
  3. Content-Type must be `image/*`
  4. Body capped at MAX_BYTES — both via Content-Length pre-check and
     via a read-one-byte-past-cap overrun detector
  5. No 3xx redirects (canonical SSRF bypass)

We mock socket.getaddrinfo + urllib's opener — pure unit tests, no
real HTTP.
"""
from __future__ import annotations

import io
from unittest.mock import patch

import pytest

from app import image_download
from app.image_download import (
    DownloadError,
    DownloadedImage,
    download_image,
)


# ---------- happy path ----------


def _fake_response(body: bytes, content_type: str = "image/jpeg",
                   content_length: str | None = None) -> object:
    """Mimic enough of urllib's response object for download_image."""

    class _FakeResp(io.BytesIO):
        def __init__(self) -> None:
            super().__init__(body)
            self.headers = {"Content-Type": content_type}
            if content_length is not None:
                self.headers["Content-Length"] = content_length

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            self.close()
            return False

    return _FakeResp()


def _patch_safe_dns():
    """Force `_is_safe_host` to return True without actually touching DNS."""
    return patch.object(image_download, "_is_safe_host", return_value=True)


def test_download_image_happy_path():
    body = b"fake-jpeg-bytes"
    with _patch_safe_dns(), patch.object(
        image_download._OPENER, "open", return_value=_fake_response(body)
    ):
        result = download_image("https://example.com/x.jpg")
    assert isinstance(result, DownloadedImage)
    assert result.bytes_ == body
    assert result.content_type == "image/jpeg"
    assert len(result.sha256) == 64  # hex-encoded sha256
    assert result.extension == ".jpg"


def test_download_image_extension_for_known_types():
    body = b"x"
    cases = {
        "image/png": ".png",
        "image/gif": ".gif",
        "image/webp": ".webp",
        "image/svg+xml": ".svg",
    }
    for ct, ext in cases.items():
        with _patch_safe_dns(), patch.object(
            image_download._OPENER, "open",
            return_value=_fake_response(body, content_type=ct),
        ):
            result = download_image("https://example.com/x")
        assert result.extension == ext, f"failed for {ct}"


def test_download_image_extension_falls_back_to_bin():
    """Exotic but valid `image/*` types still upload — just with
    the .bin extension, because the bytes are still the bytes."""
    with _patch_safe_dns(), patch.object(
        image_download._OPENER, "open",
        return_value=_fake_response(b"x", content_type="image/heic"),
    ):
        result = download_image("https://example.com/x")
    assert result.extension == ".bin"


# ---------- scheme + host validation ----------


def test_download_image_rejects_http():
    with pytest.raises(DownloadError, match="https"):
        download_image("http://example.com/x.jpg")


def test_download_image_rejects_no_host():
    with pytest.raises(DownloadError, match="no host"):
        download_image("https:///x.jpg")


def test_download_image_rejects_private_ip():
    """`_is_safe_host` checks every resolved IP. A private one fails."""
    import socket
    # 192.168.x.x is RFC1918 private. Mock getaddrinfo to return it.
    fake_addrinfo = [(socket.AF_INET, socket.SOCK_STREAM, 0, "", ("192.168.1.5", 0))]
    with patch("socket.getaddrinfo", return_value=fake_addrinfo):
        with pytest.raises(DownloadError, match="non-public IP"):
            download_image("https://internal.example.com/x.jpg")


def test_download_image_rejects_loopback():
    import socket
    fake_addrinfo = [(socket.AF_INET, socket.SOCK_STREAM, 0, "", ("127.0.0.1", 0))]
    with patch("socket.getaddrinfo", return_value=fake_addrinfo):
        with pytest.raises(DownloadError, match="non-public IP"):
            download_image("https://localhost-alias.example.com/x.jpg")


def test_download_image_rejects_link_local():
    import socket
    # 169.254.x.x is link-local — used by AWS metadata service (the
    # canonical SSRF target).
    fake_addrinfo = [(socket.AF_INET, socket.SOCK_STREAM, 0, "", ("169.254.169.254", 0))]
    with patch("socket.getaddrinfo", return_value=fake_addrinfo):
        with pytest.raises(DownloadError, match="non-public IP"):
            download_image("https://metadata.example.com/x.jpg")


def test_download_image_rejects_unresolvable_host():
    import socket
    with patch("socket.getaddrinfo", side_effect=socket.gaierror("nope")):
        with pytest.raises(DownloadError, match="non-public IP"):
            download_image("https://does-not-exist.example.com/x.jpg")


# ---------- content-type + size ----------


def test_download_image_rejects_non_image_content_type():
    with _patch_safe_dns(), patch.object(
        image_download._OPENER, "open",
        return_value=_fake_response(b"<html>", content_type="text/html"),
    ):
        with pytest.raises(DownloadError, match="not an image"):
            download_image("https://example.com/page.html")


def test_download_image_rejects_oversized_via_content_length():
    """Pre-flight rejection — Content-Length declared > MAX_BYTES so
    we never even read the body."""
    huge = str(image_download.MAX_BYTES + 1)
    with _patch_safe_dns(), patch.object(
        image_download._OPENER, "open",
        return_value=_fake_response(b"unused", content_length=huge),
    ):
        with pytest.raises(DownloadError, match="exceeds"):
            download_image("https://example.com/big.jpg")


def test_download_image_rejects_oversized_when_content_length_lies():
    """Server may not send Content-Length, or may lie. The read cap
    catches it anyway: we read MAX_BYTES + 1 and check length."""
    body = b"x" * (image_download.MAX_BYTES + 100)
    with _patch_safe_dns(), patch.object(
        image_download._OPENER, "open",
        return_value=_fake_response(body),  # no content_length set
    ):
        with pytest.raises(DownloadError, match="exceeds"):
            download_image("https://example.com/big.jpg")


def test_download_image_accepts_at_cap():
    """Exactly MAX_BYTES is allowed. Boundary check."""
    body = b"x" * image_download.MAX_BYTES
    with _patch_safe_dns(), patch.object(
        image_download._OPENER, "open",
        return_value=_fake_response(body),
    ):
        result = download_image("https://example.com/exact.jpg")
    assert len(result.bytes_) == image_download.MAX_BYTES


# ---------- redirects ----------


def test_download_image_refuses_redirects():
    """Custom HTTPRedirectHandler raises DownloadError on any 3xx.
    We exercise it directly since wiring up a real redirect-returning
    fake response is more ceremony than the test is worth."""
    handler = image_download._NoRedirectHandler()
    with pytest.raises(DownloadError, match="Refusing to follow"):
        handler.redirect_request(
            req=None, fp=None, code=302,
            msg="Found", headers={}, newurl="https://internal/x",
        )
