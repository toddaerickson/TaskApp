"""Unit tests for the local→public URL resolver and the StaticFiles mount.

The resolver is the seam between "what's stored in the DB" and "what the
client renders" so it gets exhaustive coverage — silent passthrough
regressions would re-introduce the byte-rot problem self-hosting was
supposed to solve.
"""
from app import config
from app.image_urls import resolve_image_url


# ---------- resolve_image_url() ----------

def test_resolve_passes_https_through_unchanged(monkeypatch):
    monkeypatch.setattr(config, "BACKEND_PUBLIC_URL", "https://api.example.com")
    assert resolve_image_url("https://cdn.example.com/foo.jpg") == "https://cdn.example.com/foo.jpg"


def test_resolve_passes_http_through_unchanged(monkeypatch):
    monkeypatch.setattr(config, "BACKEND_PUBLIC_URL", "https://api.example.com")
    assert resolve_image_url("http://insecure.example.com/foo.jpg") == "http://insecure.example.com/foo.jpg"


def test_resolve_expands_local_prefix(monkeypatch):
    monkeypatch.setattr(config, "BACKEND_PUBLIC_URL", "https://api.example.com")
    assert (
        resolve_image_url("local:abc123.jpg")
        == "https://api.example.com/static/exercise-images/abc123.jpg"
    )


def test_resolve_emits_relative_path_when_base_unset(monkeypatch):
    """Production must set BACKEND_PUBLIC_URL — empty returns a same-origin
    relative path. The test client mounts at the same origin so the path
    is still loadable, but RN native rejects relative URIs."""
    monkeypatch.setattr(config, "BACKEND_PUBLIC_URL", "")
    assert resolve_image_url("local:abc123.jpg") == "/static/exercise-images/abc123.jpg"


def test_resolve_handles_empty_string():
    assert resolve_image_url("") == ""


def test_resolve_passes_unknown_scheme_through(monkeypatch):
    """Future-proof: a `data:` URL or an unrecognized scheme shouldn't be
    rewritten as if it were a local: path."""
    monkeypatch.setattr(config, "BACKEND_PUBLIC_URL", "https://api.example.com")
    assert resolve_image_url("data:image/png;base64,iVBOR...") == "data:image/png;base64,iVBOR..."


# ---------- End-to-end through the API ----------

def _h(token):
    return {"Authorization": f"Bearer {token}"}


def test_get_exercise_expands_local_url(auth_client, seeded_globals, monkeypatch):
    """A row stored as `local:hash.jpg` comes back as the full public URL
    on GET. Confirms the hydrator wires through to the resolver."""
    from app.database import get_db
    monkeypatch.setattr(config, "BACKEND_PUBLIC_URL", "https://api.test")
    c, tok, _ = auth_client
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO exercise_images (exercise_id, url, sort_order, content_hash) "
            "VALUES (?, ?, ?, ?)",
            (seeded_globals["wall"], "local:abc123.jpg", 0, "fakehash"),
        )
    fetched = c.get(f"/exercises/{seeded_globals['wall']}", headers=_h(tok)).json()
    assert fetched["images"][0]["url"] == "https://api.test/static/exercise-images/abc123.jpg"


def test_get_routine_expands_local_url(auth_client, seeded_globals, monkeypatch):
    """Routine GET reuses the same hydrator path — the rewrite has to apply
    on nested exercise images too, not just the top-level exercise list."""
    from app.database import get_db
    monkeypatch.setattr(config, "BACKEND_PUBLIC_URL", "https://api.test")
    c, tok, _ = auth_client
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO exercise_images (exercise_id, url, sort_order, content_hash) "
            "VALUES (?, ?, ?, ?)",
            (seeded_globals["wall"], "local:r.jpg", 0, "fakehashR"),
        )
    routine = c.post(
        "/routines",
        headers=_h(tok),
        json={"name": "Mobility AM", "exercises": [{"exercise_id": seeded_globals["wall"]}]},
    ).json()
    fetched = c.get(f"/routines/{routine['id']}", headers=_h(tok)).json()
    img = fetched["exercises"][0]["exercise"]["images"][0]
    assert img["url"] == "https://api.test/static/exercise-images/r.jpg"


def test_add_image_response_resolves_url(auth_client, seeded_globals, monkeypatch):
    """The single-image POST response also resolves — clients shouldn't
    have to reload the parent exercise to get a usable URL."""
    monkeypatch.setattr(config, "BACKEND_PUBLIC_URL", "https://api.test")
    c, tok, _ = auth_client
    r = c.post(
        f"/exercises/{seeded_globals['wall']}/images",
        headers=_h(tok),
        json={"url": "local:fresh.jpg"},
    )
    assert r.status_code == 200
    assert r.json()["url"] == "https://api.test/static/exercise-images/fresh.jpg"


def test_add_image_response_passes_https_through(auth_client, seeded_globals, monkeypatch):
    """Existing CDN URLs round-trip unchanged — no double prefixing."""
    monkeypatch.setattr(config, "BACKEND_PUBLIC_URL", "https://api.test")
    c, tok, _ = auth_client
    r = c.post(
        f"/exercises/{seeded_globals['wall']}/images",
        headers=_h(tok),
        json={"url": "https://cdn.example.com/x.jpg"},
    )
    assert r.json()["url"] == "https://cdn.example.com/x.jpg"


# ---------- StaticFiles mount ----------

def test_static_mount_serves_image_bytes(client, tmp_path, monkeypatch):
    """The /static/exercise-images mount serves files from the seed_data
    directory. We write a fake byte payload directly so the test doesn't
    depend on any backfill having run."""
    from main import _IMAGE_DIR
    fake = _IMAGE_DIR / "test_payload.bin"
    fake.write_bytes(b"hello-from-static")
    try:
        r = client.get("/static/exercise-images/test_payload.bin")
        assert r.status_code == 200
        assert r.content == b"hello-from-static"
    finally:
        fake.unlink(missing_ok=True)


def test_static_mount_404_on_missing_file(client):
    r = client.get("/static/exercise-images/this-does-not-exist.jpg")
    assert r.status_code == 404


def test_static_mount_404s_dotfiles(client):
    """The mount is unauthenticated. A stray `.DS_Store`, editor swap, or
    future SOPS leftover in the seed dir must not leak. Subclass guard
    runs before the disk lookup."""
    from main import _IMAGE_DIR
    fake = _IMAGE_DIR / ".secret"
    fake.write_bytes(b"shouldnotleak")
    try:
        r = client.get("/static/exercise-images/.secret")
        assert r.status_code == 404
    finally:
        fake.unlink(missing_ok=True)


def test_health_detailed_reports_public_url_configured(client):
    """The diagnostic endpoint exposes whether BACKEND_PUBLIC_URL was set
    so the operator can curl Fly and see it without grepping logs."""
    r = client.get("/health/detailed")
    assert r.status_code == 200
    body = r.json()
    assert "public_url_configured" in body
    # Test env is SQLite by default; the warn-loudly logic is PG-only,
    # so SQLite always reports True regardless of env value.
    assert body["public_url_configured"] is True
