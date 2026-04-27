"""Tests for the backfill-exercise-images CLI helpers.

Network is fully mocked — `urllib.request.urlopen` is replaced with an
in-memory fake so the suite stays hermetic. The DB calls go through the
existing test fixtures (SQLite or Postgres depending on the matrix leg).
"""
import io
import urllib.error

from app.database import get_db
from scripts import backfill_exercise_images as bf


# ---------- extract_extension ----------

def test_extract_extension_prefers_content_type():
    assert bf.extract_extension("image/jpeg", "https://example.com/foo.png") == "jpg"


def test_extract_extension_strips_charset():
    assert bf.extract_extension("image/png; charset=binary", "https://x/y") == "png"


def test_extract_extension_falls_back_to_url_ext():
    assert bf.extract_extension(None, "https://example.com/foo.webp") == "webp"


def test_extract_extension_falls_back_when_content_type_unknown():
    assert bf.extract_extension("text/html", "https://example.com/foo.gif") == "gif"


def test_extract_extension_normalises_jpeg_url_to_jpeg():
    """A URL ending in .jpeg keeps that token (rather than being silently
    rewritten to .jpg) so the on-disk filename is unambiguous when the
    content type is missing."""
    assert bf.extract_extension(None, "https://example.com/foo.jpeg") == "jpeg"


def test_extract_extension_returns_none_for_unsupported():
    assert bf.extract_extension(None, "https://example.com/foo.svg") is None
    assert bf.extract_extension("application/pdf", "https://example.com/foo") is None


# ---------- compute_filename ----------

def test_compute_filename_is_content_addressed():
    f1 = bf.compute_filename(b"abc", "jpg")
    f2 = bf.compute_filename(b"abc", "jpg")
    f3 = bf.compute_filename(b"def", "jpg")
    assert f1 == f2
    assert f1 != f3
    assert f1.endswith(".jpg")
    # SHA-256 hex is 64 chars + ".jpg" = 68
    assert len(f1) == 68


# ---------- download_image (mocked urlopen) ----------

class _FakeResponse:
    """Single-shot fake. read(n) honors n + tracks position so the loop
    in download_image terminates the same way it would against a real
    socket — the previous version returned `body[:n]` every call which
    made the read-loop spin forever."""

    def __init__(self, body: bytes, content_type: str | None = "image/jpeg"):
        self._body = body
        self._pos = 0
        self.headers = {"Content-Type": content_type} if content_type else {}

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def read(self, n: int) -> bytes:
        chunk = self._body[self._pos:self._pos + n]
        self._pos += len(chunk)
        return chunk


def test_download_image_returns_body_and_content_type(monkeypatch):
    monkeypatch.setattr(
        bf.urllib.request, "urlopen",
        lambda req, timeout: _FakeResponse(b"hello", "image/png"),
    )
    body, ct = bf.download_image("https://example.com/x.png")
    assert body == b"hello"
    assert ct == "image/png"


def test_download_image_rejects_oversized_body(monkeypatch):
    """The cap is enforced *after* read() so a malicious server can't
    smuggle gigabytes by lying about Content-Length."""
    big = b"x" * 100
    monkeypatch.setattr(
        bf.urllib.request, "urlopen",
        lambda req, timeout: _FakeResponse(big, "image/png"),
    )
    import pytest
    with pytest.raises(ValueError, match="exceeds max_bytes"):
        bf.download_image("https://example.com/x.png", max_bytes=10)


# ---------- backfill_one ----------

def _seed_image(cur, exercise_id: int, url: str) -> int:
    cur.execute(
        "INSERT INTO exercise_images (exercise_id, url, sort_order, content_hash) "
        "VALUES (?, ?, ?, ?)",
        (exercise_id, url, 0, "fakehash-" + url[:30]),
    )
    return cur.lastrowid


def test_backfill_one_skips_already_self_hosted(client, seeded_globals, tmp_path):
    with get_db() as conn:
        cur = conn.cursor()
        img_id = _seed_image(cur, seeded_globals["wall"], "local:abc.jpg")
        cur.execute("SELECT id, url FROM exercise_images WHERE id = ?", (img_id,))
        row = cur.fetchone()
        outcome = bf.backfill_one(
            cur, row, tmp_path, dry_run=False, max_bytes=1024, timeout=1,
        )
    assert outcome.status == "skip"
    assert "self-hosted" in outcome.detail


def test_backfill_one_skips_non_http_url(client, seeded_globals, tmp_path):
    with get_db() as conn:
        cur = conn.cursor()
        img_id = _seed_image(cur, seeded_globals["wall"], "data:image/png;base64,...")
        cur.execute("SELECT id, url FROM exercise_images WHERE id = ?", (img_id,))
        outcome = bf.backfill_one(
            cur, cur.fetchone(), tmp_path,
            dry_run=False, max_bytes=1024, timeout=1,
        )
    assert outcome.status == "skip"


def test_backfill_one_writes_file_and_updates_url(client, seeded_globals, tmp_path, monkeypatch):
    payload = b"binary-image-bytes"
    monkeypatch.setattr(
        bf.urllib.request, "urlopen",
        lambda req, timeout: _FakeResponse(payload, "image/jpeg"),
    )
    with get_db() as conn:
        cur = conn.cursor()
        img_id = _seed_image(cur, seeded_globals["wall"], "https://cdn.example.com/foo.jpg")
        cur.execute("SELECT id, url FROM exercise_images WHERE id = ?", (img_id,))
        outcome = bf.backfill_one(
            cur, cur.fetchone(), tmp_path,
            dry_run=False, max_bytes=1024, timeout=1,
        )
        cur.execute("SELECT url FROM exercise_images WHERE id = ?", (img_id,))
        stored = cur.fetchone()["url"]

    assert outcome.status == "ok"
    assert outcome.bytes_written == len(payload)
    assert stored.startswith("local:")
    assert stored.endswith(".jpg")
    # The on-disk filename must match the URL's filename.
    filename = stored.split(":", 1)[1]
    assert (tmp_path / filename).read_bytes() == payload


def test_backfill_one_dry_run_does_not_write_or_update(client, seeded_globals, tmp_path, monkeypatch):
    payload = b"dry-bytes"
    monkeypatch.setattr(
        bf.urllib.request, "urlopen",
        lambda req, timeout: _FakeResponse(payload, "image/png"),
    )
    with get_db() as conn:
        cur = conn.cursor()
        img_id = _seed_image(cur, seeded_globals["wall"], "https://cdn.example.com/foo.png")
        cur.execute("SELECT id, url FROM exercise_images WHERE id = ?", (img_id,))
        outcome = bf.backfill_one(
            cur, cur.fetchone(), tmp_path,
            dry_run=True, max_bytes=1024, timeout=1,
        )
        cur.execute("SELECT url FROM exercise_images WHERE id = ?", (img_id,))
        stored = cur.fetchone()["url"]

    assert outcome.status == "ok"
    # URL preserved in dry-run; nothing on disk.
    assert stored == "https://cdn.example.com/foo.png"
    assert list(tmp_path.iterdir()) == []
    # The "would-be" target URL is reported so the operator can audit.
    assert outcome.new_url is not None
    assert outcome.new_url.startswith("local:") and outcome.new_url.endswith(".png")


def test_backfill_one_handles_http_error(client, seeded_globals, tmp_path, monkeypatch):
    def _raise(req, timeout):
        raise urllib.error.HTTPError(req.full_url, 404, "Not Found", {}, io.BytesIO())
    monkeypatch.setattr(bf.urllib.request, "urlopen", _raise)
    with get_db() as conn:
        cur = conn.cursor()
        img_id = _seed_image(cur, seeded_globals["wall"], "https://cdn.example.com/missing.jpg")
        cur.execute("SELECT id, url FROM exercise_images WHERE id = ?", (img_id,))
        outcome = bf.backfill_one(
            cur, cur.fetchone(), tmp_path,
            dry_run=False, max_bytes=1024, timeout=1,
        )
    assert outcome.status == "fail"
    assert "404" in outcome.detail


def test_backfill_one_rejects_unsupported_content_type(client, seeded_globals, tmp_path, monkeypatch):
    """SVG / PDF / HTML responses get skipped rather than written under
    a wrong extension. Critical because some image-search providers serve
    error pages with 200 OK + text/html."""
    monkeypatch.setattr(
        bf.urllib.request, "urlopen",
        lambda req, timeout: _FakeResponse(b"<svg/>", "image/svg+xml"),
    )
    with get_db() as conn:
        cur = conn.cursor()
        img_id = _seed_image(cur, seeded_globals["wall"], "https://cdn.example.com/x")
        cur.execute("SELECT id, url FROM exercise_images WHERE id = ?", (img_id,))
        outcome = bf.backfill_one(
            cur, cur.fetchone(), tmp_path,
            dry_run=False, max_bytes=1024, timeout=1,
        )
    assert outcome.status == "fail"
    assert "unsupported content-type" in outcome.detail


def test_backfill_one_idempotent_when_file_already_present(client, seeded_globals, tmp_path, monkeypatch):
    """Same bytes the second time → same content-addressed filename →
    no duplicate disk write, but the URL still gets rewritten on the
    new row. Tests that the script can rerun safely after partial
    failures."""
    payload = b"content"
    monkeypatch.setattr(
        bf.urllib.request, "urlopen",
        lambda req, timeout: _FakeResponse(payload, "image/jpeg"),
    )
    with get_db() as conn:
        cur = conn.cursor()
        # First row downloads + writes the file.
        a = _seed_image(cur, seeded_globals["wall"], "https://cdn.example.com/a.jpg")
        cur.execute("SELECT id, url FROM exercise_images WHERE id = ?", (a,))
        oa = bf.backfill_one(cur, cur.fetchone(), tmp_path,
                             dry_run=False, max_bytes=1024, timeout=1)
        # Second row, different URL, identical bytes — same hash, no
        # second write. Pre-stamp the file with sentinel content; if
        # the script re-wrote it we'd notice.
        filename = oa.new_url.split(":", 1)[1]
        target = tmp_path / filename
        target.write_bytes(b"untouched-sentinel")

        b = _seed_image(cur, seeded_globals["wall"], "https://cdn.example.com/b.jpg")
        cur.execute("SELECT id, url FROM exercise_images WHERE id = ?", (b,))
        ob = bf.backfill_one(cur, cur.fetchone(), tmp_path,
                             dry_run=False, max_bytes=1024, timeout=1)
        cur.execute("SELECT url FROM exercise_images WHERE id = ?", (b,))
        stored_b = cur.fetchone()["url"]

    assert ob.status == "ok"
    assert stored_b == oa.new_url
    # Sentinel survived → no second write.
    assert target.read_bytes() == b"untouched-sentinel"


# ---------- backfill_all (loop + max_rows) ----------

def test_backfill_all_respects_max_rows(client, seeded_globals, tmp_path, monkeypatch):
    monkeypatch.setattr(
        bf.urllib.request, "urlopen",
        lambda req, timeout: _FakeResponse(b"x", "image/jpeg"),
    )
    with get_db() as conn:
        cur = conn.cursor()
        for i in range(5):
            _seed_image(cur, seeded_globals["wall"], f"https://cdn.example.com/{i}.jpg")
        outcomes = bf.backfill_all(
            cur, tmp_path,
            dry_run=False, max_rows=3, max_bytes=1024, timeout=1,
        )
    assert len(outcomes) == 3
    assert all(o.status == "ok" for o in outcomes)


# ---------- chunked / short-read guard ----------

class _ChunkedFakeResponse:
    """Simulates a chunked HTTP response where read(n) returns one chunk
    per call regardless of n. Mirrors the real `http.client.HTTPResponse`
    behavior on chunked transfer where reads short-circuit at chunk
    boundaries."""

    def __init__(self, chunks: list[bytes], content_type: str = "image/jpeg"):
        self._chunks = list(chunks)
        self.headers = {"Content-Type": content_type}

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def read(self, n: int) -> bytes:  # noqa: ARG002 — n intentionally ignored
        if not self._chunks:
            return b""
        return self._chunks.pop(0)


def test_download_image_loops_until_eof_on_chunked_response(monkeypatch):
    """Without the read() loop, chunked responses lose data after the
    first chunk and the file gets written under a hash that represents
    a truncated body. Verify the loop drains every chunk."""
    chunks = [b"chunk1-", b"chunk2-", b"chunk3"]
    monkeypatch.setattr(
        bf.urllib.request, "urlopen",
        lambda req, timeout: _ChunkedFakeResponse(chunks),
    )
    body, _ = bf.download_image("https://example.com/x.jpg", max_bytes=1024)
    assert body == b"chunk1-chunk2-chunk3"


def test_download_image_caps_chunked_response(monkeypatch):
    """Cap enforcement still works when the body arrives across chunks
    and the total exceeds max_bytes."""
    chunks = [b"a" * 6, b"b" * 6]   # 12 bytes total
    monkeypatch.setattr(
        bf.urllib.request, "urlopen",
        lambda req, timeout: _ChunkedFakeResponse(chunks),
    )
    import pytest
    with pytest.raises(ValueError, match="exceeds max_bytes"):
        bf.download_image("https://example.com/x.jpg", max_bytes=10)


# ---------- SSRF guard ----------

def test_is_safe_remote_host_blocks_loopback(monkeypatch):
    monkeypatch.setattr(
        bf.socket, "getaddrinfo",
        lambda host, port: [(0, 0, 0, "", ("127.0.0.1", 0))],
    )
    assert bf.is_safe_remote_host("evil.example.com") is False


def test_is_safe_remote_host_blocks_private(monkeypatch):
    monkeypatch.setattr(
        bf.socket, "getaddrinfo",
        lambda host, port: [(0, 0, 0, "", ("10.0.0.5", 0))],
    )
    assert bf.is_safe_remote_host("internal.example.com") is False


def test_is_safe_remote_host_blocks_link_local_metadata(monkeypatch):
    """The classic AWS / GCP metadata endpoint."""
    monkeypatch.setattr(
        bf.socket, "getaddrinfo",
        lambda host, port: [(0, 0, 0, "", ("169.254.169.254", 0))],
    )
    assert bf.is_safe_remote_host("metadata.example.com") is False


def test_is_safe_remote_host_allows_public(monkeypatch):
    monkeypatch.setattr(
        bf.socket, "getaddrinfo",
        lambda host, port: [(0, 0, 0, "", ("93.184.216.34", 0))],
    )
    assert bf.is_safe_remote_host("example.com") is True


def test_backfill_one_skips_private_host(client, seeded_globals, tmp_path, monkeypatch):
    monkeypatch.setattr(
        bf.socket, "getaddrinfo",
        lambda host, port: [(0, 0, 0, "", ("127.0.0.1", 0))],
    )
    with get_db() as conn:
        cur = conn.cursor()
        img_id = _seed_image(cur, seeded_globals["wall"], "https://localhost/foo.jpg")
        cur.execute("SELECT id, url FROM exercise_images WHERE id = ?", (img_id,))
        outcome = bf.backfill_one(
            cur, cur.fetchone(), tmp_path,
            dry_run=False, max_bytes=1024, timeout=1,
        )
    assert outcome.status == "skip"
    assert "SSRF" in outcome.detail


def test_backfill_one_allow_private_hosts_bypasses_guard(client, seeded_globals, tmp_path, monkeypatch):
    """Operator opt-out for an internal-mirror scenario."""
    monkeypatch.setattr(
        bf.socket, "getaddrinfo",
        lambda host, port: [(0, 0, 0, "", ("127.0.0.1", 0))],
    )
    monkeypatch.setattr(
        bf.urllib.request, "urlopen",
        lambda req, timeout: _FakeResponse(b"private-bytes", "image/jpeg"),
    )
    with get_db() as conn:
        cur = conn.cursor()
        img_id = _seed_image(cur, seeded_globals["wall"], "https://internal.local/x.jpg")
        cur.execute("SELECT id, url FROM exercise_images WHERE id = ?", (img_id,))
        outcome = bf.backfill_one(
            cur, cur.fetchone(), tmp_path,
            dry_run=False, max_bytes=1024, timeout=1,
            allow_private_hosts=True,
        )
    assert outcome.status == "ok"


# ---------- git work tree guard ----------

def test_is_inside_git_work_tree_finds_dot_git(tmp_path):
    (tmp_path / ".git").mkdir()
    nested = tmp_path / "a" / "b" / "c"
    nested.mkdir(parents=True)
    assert bf.is_inside_git_work_tree(nested) is True


def test_is_inside_git_work_tree_missing(tmp_path):
    assert bf.is_inside_git_work_tree(tmp_path) is False
