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


# ---------- Path-traversal hardening (PR-A1) ----------
# A malformed `local:` sentinel that escapes the StaticFiles mount's
# subclass guard could still produce a surprising URL. Validation at
# the resolver returns "" so the client renders a broken-image
# placeholder rather than navigating to a forged path.

def test_resolve_rejects_local_with_slash(monkeypatch):
    monkeypatch.setattr(config, "BACKEND_PUBLIC_URL", "https://api.example.com")
    assert resolve_image_url("local:foo/bar.jpg") == ""


def test_resolve_rejects_local_with_backslash(monkeypatch):
    monkeypatch.setattr(config, "BACKEND_PUBLIC_URL", "https://api.example.com")
    assert resolve_image_url("local:foo\\bar.jpg") == ""


def test_resolve_rejects_local_with_dotdot(monkeypatch):
    monkeypatch.setattr(config, "BACKEND_PUBLIC_URL", "https://api.example.com")
    assert resolve_image_url("local:..secret.jpg") == ""
    assert resolve_image_url("local:foo..bar.jpg") == ""


def test_resolve_rejects_empty_local(monkeypatch):
    """`local:` with no filename — corrupt sentinel — also returns empty."""
    monkeypatch.setattr(config, "BACKEND_PUBLIC_URL", "https://api.example.com")
    assert resolve_image_url("local:") == ""


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
    so the operator can curl Fly with the bearer token and see it
    without grepping logs."""
    import os
    headers = {"Authorization": f"Bearer {os.environ['SNAPSHOT_AUTH_TOKEN']}"}
    r = client.get("/health/detailed", headers=headers)
    assert r.status_code == 200
    body = r.json()
    assert "public_url_configured" in body
    # Test env is SQLite by default; the warn-loudly logic is PG-only,
    # so SQLite always reports True regardless of env value.
    assert body["public_url_configured"] is True


# ---------- IMAGE_STORAGE_DIR env override (PR-A2a) ----------
# The path defaults to seed_data/exercise_images/ but is env-driven so
# tests + future Fly Volume / R2-mirror deploys can swap the backing
# location. The default is still the committed dir, so nothing changes
# for the operator without an explicit env var.

def test_image_storage_dir_default_is_seed_data():
    """No env override → default is `backend/seed_data/exercise_images/`
    relative to the project. Confirms the default-resolution math (which
    walks up two parents from app/config.py) didn't drift."""
    from app import config
    assert config.IMAGE_STORAGE_DIR.name == "exercise_images"
    assert config.IMAGE_STORAGE_DIR.parent.name == "seed_data"


def test_image_storage_dir_respects_env(monkeypatch, tmp_path):
    """`IMAGE_STORAGE_DIR=/some/path` → that's what gets used. We
    re-import config in a way that picks up the env var, then confirm
    it took. Importing config inside the test block (rather than top of
    file) keeps the live module's value untouched for other tests."""
    import importlib
    monkeypatch.setenv("IMAGE_STORAGE_DIR", str(tmp_path))
    # SECURITY: the reload changes module state for the rest of this
    # test only; pytest's monkeypatch reverses the env on teardown,
    # but the module value persists. We restore on the way out.
    from app import config
    original = config.IMAGE_STORAGE_DIR
    try:
        importlib.reload(config)
        assert config.IMAGE_STORAGE_DIR == tmp_path
    finally:
        # Reload once more without the env var so the next test sees
        # the canonical default. monkeypatch unsets the env var on its
        # own teardown, so the second reload here picks up the unset.
        monkeypatch.delenv("IMAGE_STORAGE_DIR", raising=False)
        importlib.reload(config)
        assert config.IMAGE_STORAGE_DIR == original
