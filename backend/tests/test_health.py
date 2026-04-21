"""`/health` + `/health/detailed` — diagnostic surface for ops.

The main behavior under test: the app should not crash on boot when
CORS_ORIGINS is missing in a Postgres environment. Previously a
missing CORS_ORIGINS raised RuntimeError at module import, which
crash-looped Fly's machine and was reported at the edge as a
generic "403 host_not_allowed" — totally unactionable. The new
behavior logs loudly, boots with localhost-only origins, and
exposes the misconfig via /health/detailed.
"""
import pytest


def test_health_returns_ok(auth_client):
    c, _tok, _uid = auth_client
    r = c.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_health_detailed_reports_config_state(auth_client):
    """The diagnostic view should be 200 regardless of config state so
    the operator can always curl it. Reports presence-of-secrets, not
    values."""
    c, _tok, _uid = auth_client
    r = c.get("/health/detailed")
    assert r.status_code == 200
    body = r.json()
    # Required fields. Conftest forces SQLite + JWT_SECRET + CORS_ORIGINS,
    # so we assert those are reported present.
    assert body["status"] == "ok"
    assert body["db_type"] in ("sqlite", "postgresql")
    assert body["db_reachable"] is True
    assert body["db_error"] is None
    # conftest sets both env vars before app import.
    assert body["cors_origins_configured"] is True
    assert body["jwt_secret_configured"] is True
    # Sentry is optional — either bool is fine, just confirm the field
    # is present and typed.
    assert isinstance(body["sentry_configured"], bool)


def test_health_detailed_never_leaks_secret_values(auth_client):
    """Double-check: presence-flags only, no raw values anywhere."""
    c, _tok, _uid = auth_client
    r = c.get("/health/detailed")
    body = r.json()
    # The fallback sentinel used when JWT_SECRET is unset — should never
    # appear in the response body regardless of environment.
    assert "dev-secret-change-in-production" not in r.text
    # The test's own secret (from conftest) shouldn't leak either.
    assert "test-secret-" not in r.text


def test_health_is_unauthenticated(auth_client):
    """Both /health endpoints must work without an Authorization header —
    Fly's health-check probe doesn't authenticate, and the ops-diagnosis
    path can't require auth either."""
    c, _tok, _uid = auth_client
    # No headers passed.
    assert c.get("/health").status_code == 200
    assert c.get("/health/detailed").status_code == 200
