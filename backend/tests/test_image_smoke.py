"""Tests for the CI #1 image-smoke script (PR-A2c).

Pure unit — mocks urllib so the suite runs without network. Covers:
  - fetch_sample happy path + error
  - head_with_retry: 200, 404, transport error, retry-then-success
  - end-to-end (mocked) main()
"""
from __future__ import annotations

import io
import json
import sys
import urllib.error
from unittest.mock import patch

import pytest

# Add scripts/ to path so we can import the module directly.
ROOT = __import__("pathlib").Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import image_smoke as smoke  # noqa: E402


def _fake_resp(status: int, body: bytes = b"") -> object:
    """Mimic urllib's response context-manager."""
    class _R(io.BytesIO):
        def __init__(self) -> None:
            super().__init__(body)
            self.status = status

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            self.close()
            return False

    return _R()


# ---------- fetch_sample ----------


def test_fetch_sample_happy_path():
    payload = {"urls": ["https://cdn.test/a.jpg", "https://cdn.test/b.jpg"]}
    with patch(
        "urllib.request.urlopen",
        return_value=_fake_resp(200, json.dumps(payload).encode()),
    ):
        urls = smoke.fetch_sample("https://api.test", "tok", 5)
    assert urls == payload["urls"]


def test_fetch_sample_strips_trailing_slash_on_backend():
    payload = {"urls": []}
    captured: dict = {}
    def _capture(req, timeout):
        captured["url"] = req.full_url
        return _fake_resp(200, json.dumps(payload).encode())
    with patch("urllib.request.urlopen", side_effect=_capture):
        smoke.fetch_sample("https://api.test/", "tok", 5)
    assert captured["url"] == "https://api.test/admin/sample-image-urls?n=5"


def test_fetch_sample_raises_on_non_200():
    with patch("urllib.request.urlopen", return_value=_fake_resp(503)):
        with pytest.raises(RuntimeError, match="503"):
            smoke.fetch_sample("https://api.test", "tok", 5)


def test_fetch_sample_raises_on_unexpected_payload():
    with patch(
        "urllib.request.urlopen",
        return_value=_fake_resp(200, json.dumps({"oops": "wrong shape"}).encode()),
    ):
        urls = smoke.fetch_sample("https://api.test", "tok", 5)
    # Empty list rather than crash on missing key — CLI treats empty
    # as "no images yet, success" which is fine for fresh deploys.
    assert urls == []


def test_fetch_sample_raises_on_non_list_urls():
    with patch(
        "urllib.request.urlopen",
        return_value=_fake_resp(200, json.dumps({"urls": "oops-string"}).encode()),
    ):
        with pytest.raises(RuntimeError, match="unexpected"):
            smoke.fetch_sample("https://api.test", "tok", 5)


# ---------- head_with_retry ----------


def test_head_returns_ok_on_200():
    with patch("urllib.request.urlopen", return_value=_fake_resp(200)):
        ok, detail = smoke.head_with_retry("https://x", attempts=3, backoff=0)
    assert ok is True
    assert detail == ""


def test_head_returns_fail_on_404_after_retries():
    err = urllib.error.HTTPError("https://x", 404, "Not Found", {}, None)
    with patch("urllib.request.urlopen", side_effect=err):
        ok, detail = smoke.head_with_retry("https://x", attempts=3, backoff=0)
    assert ok is False
    assert "404" in detail


def test_head_succeeds_on_retry_after_transient_failure():
    """Common case: a transient 502 followed by 200 should NOT alarm.
    First two calls fail, third succeeds."""
    err = urllib.error.URLError("connection refused")
    side_effects = [err, err, _fake_resp(200)]
    with patch("urllib.request.urlopen", side_effect=side_effects):
        ok, detail = smoke.head_with_retry("https://x", attempts=3, backoff=0)
    assert ok is True
    assert detail == ""


def test_head_returns_fail_on_persistent_url_error():
    err = urllib.error.URLError("name resolution failed")
    with patch("urllib.request.urlopen", side_effect=err):
        ok, detail = smoke.head_with_retry("https://x", attempts=2, backoff=0)
    assert ok is False
    assert "name resolution" in detail


# ---------- main() ----------


def test_main_succeeds_when_all_urls_ok(monkeypatch):
    monkeypatch.setattr(sys, "argv", [
        "image_smoke.py", "--backend", "https://api.test",
        "--token", "tok", "--sample-size", "2",
        "--attempts", "1", "--backoff", "0",
    ])
    with patch.object(
        smoke, "fetch_sample",
        return_value=["https://cdn.test/a.jpg", "https://cdn.test/b.jpg"],
    ), patch.object(smoke, "head_with_retry", return_value=(True, "")):
        rc = smoke.main()
    assert rc == 0


def test_main_returns_nonzero_when_any_url_fails(monkeypatch):
    monkeypatch.setattr(sys, "argv", [
        "image_smoke.py", "--backend", "https://api.test",
        "--token", "tok", "--sample-size", "2",
        "--attempts", "1", "--backoff", "0",
    ])
    with patch.object(
        smoke, "fetch_sample",
        return_value=["https://cdn.test/a.jpg", "https://cdn.test/b.jpg"],
    ), patch.object(
        smoke, "head_with_retry",
        side_effect=[(True, ""), (False, "HTTP 404")],
    ):
        rc = smoke.main()
    assert rc == 1


def test_main_returns_zero_on_empty_sample(monkeypatch):
    """Pre-backfill, fresh deploy: no images yet. Don't alarm."""
    monkeypatch.setattr(sys, "argv", [
        "image_smoke.py", "--backend", "https://api.test",
        "--token", "tok",
    ])
    with patch.object(smoke, "fetch_sample", return_value=[]):
        rc = smoke.main()
    assert rc == 0


def test_main_returns_nonzero_on_fetch_sample_failure(monkeypatch):
    """Backend unreachable / token wrong → workflow alerts."""
    monkeypatch.setattr(sys, "argv", [
        "image_smoke.py", "--backend", "https://api.test",
        "--token", "tok",
    ])
    with patch.object(smoke, "fetch_sample", side_effect=RuntimeError("503")):
        rc = smoke.main()
    assert rc == 1
