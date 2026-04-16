"""Tests for GET /admin/snapshot and the fire-and-forget GitHub dispatch
triggered on image save."""
import os
from unittest.mock import patch


def _set_token(monkeypatch, token: str = "tok-abc") -> str:
    monkeypatch.setenv("SNAPSHOT_AUTH_TOKEN", token)
    return token


def test_snapshot_requires_configured_token(client, monkeypatch):
    monkeypatch.delenv("SNAPSHOT_AUTH_TOKEN", raising=False)
    r = client.get("/admin/snapshot")
    assert r.status_code == 503


def test_snapshot_rejects_missing_bearer(client, monkeypatch):
    _set_token(monkeypatch)
    r = client.get("/admin/snapshot")
    assert r.status_code == 401


def test_snapshot_rejects_wrong_token(client, monkeypatch):
    _set_token(monkeypatch, "correct")
    r = client.get("/admin/snapshot", headers={"Authorization": "Bearer wrong"})
    assert r.status_code == 401


def test_snapshot_returns_globals_only_by_default(auth_client, monkeypatch, seeded_globals):
    c, _tok, _uid = auth_client
    _set_token(monkeypatch, "t1")
    r = c.get("/admin/snapshot", headers={"Authorization": "Bearer t1"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["version"] == 1
    assert isinstance(body["exercises"], list)
    # seeded_globals creates 2 globals (user_id NULL).
    slugs = {e["slug"] for e in body["exercises"]}
    assert "wall_ankle_dorsiflexion" in slugs
    assert "single_leg_glute_bridge" in slugs


def test_snapshot_includes_user_owned_when_email_passed(auth_client, monkeypatch, seeded_globals):
    c, tok, _uid = auth_client
    # Create a user-owned exercise via the public API.
    h = {"Authorization": f"Bearer {tok}"}
    r = c.post("/exercises", headers=h, json={"name": "My Custom Move", "measurement": "reps"})
    assert r.status_code == 200, r.text

    _set_token(monkeypatch, "t2")
    r = c.get("/admin/snapshot?user_email=tester@x.com", headers={"Authorization": "Bearer t2"})
    assert r.status_code == 200
    slugs = {e["slug"] for e in r.json()["exercises"]}
    assert any(s.startswith("my_custom_move") for s in slugs)


def test_snapshot_404_for_unknown_user(client, monkeypatch):
    _set_token(monkeypatch, "t3")
    r = client.get("/admin/snapshot?user_email=ghost@x.com", headers={"Authorization": "Bearer t3"})
    assert r.status_code == 404


def test_image_save_triggers_dispatch_background_task(auth_client, seeded_globals):
    """When GITHUB_DISPATCH_TOKEN is set, saving an image should enqueue
    the fire-and-forget dispatch. We patch the HTTP layer so no network
    call actually leaves."""
    c, tok, _uid = auth_client
    h = {"Authorization": f"Bearer {tok}"}
    with patch("app.github_dispatch.httpx.Client") as mock_client:
        instance = mock_client.return_value.__enter__.return_value
        instance.post.return_value.status_code = 204
        instance.post.return_value.reason_phrase = "No Content"

        with patch.dict(os.environ, {"GITHUB_DISPATCH_TOKEN": "pat-xyz"}):
            r = c.post(
                f"/exercises/{seeded_globals['wall']}/images",
                headers=h,
                json={"url": "https://example.com/a.jpg"},
            )
            assert r.status_code == 200, r.text

        # BackgroundTasks run after the response — the test client's
        # TestClient awaits them before returning control, so by now
        # the mocked post should have been called once.
        assert instance.post.called, "dispatch should have fired"
        url_arg = instance.post.call_args.args[0]
        assert url_arg.endswith("/dispatches"), url_arg


def test_image_save_dispatch_is_noop_without_token(auth_client, seeded_globals, monkeypatch):
    """No token configured = silent skip. Must not raise, must not
    attempt any HTTP call."""
    c, tok, _uid = auth_client
    h = {"Authorization": f"Bearer {tok}"}
    monkeypatch.delenv("GITHUB_DISPATCH_TOKEN", raising=False)
    with patch("app.github_dispatch.httpx.Client") as mock_client:
        r = c.post(
            f"/exercises/{seeded_globals['wall']}/images",
            headers=h,
            json={"url": "https://example.com/b.jpg"},
        )
        assert r.status_code == 200
        assert not mock_client.called, "no token ⇒ no HTTP client opened"
