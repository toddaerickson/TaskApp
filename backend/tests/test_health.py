"""`/health` + `/health/detailed` — diagnostic surface for ops.

`/health` is unauthenticated (Fly health-check probes don't authenticate).
`/health/detailed` is bearer-token gated against `SNAPSHOT_AUTH_TOKEN`
because the field-by-field truthiness reporting (db reachability,
CORS, JWT, Sentry, public-URL configured) is free reconnaissance for
anyone scraping Fly subdomains. Operator curls it with the token.
"""
import os


def _admin_h():
    return {"Authorization": f"Bearer {os.environ['SNAPSHOT_AUTH_TOKEN']}"}


def test_health_returns_ok(auth_client):
    c, _tok, _uid = auth_client
    r = c.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_health_is_unauthenticated(auth_client):
    """The basic /health endpoint must work without an Authorization
    header — Fly's probe doesn't authenticate."""
    c, _tok, _uid = auth_client
    assert c.get("/health").status_code == 200


def test_health_detailed_requires_bearer_token(auth_client):
    """The diagnostic view used to be public. Now any caller without
    the operator's bearer token gets 401 instead of a free recon dump."""
    c, _tok, _uid = auth_client
    r = c.get("/health/detailed")
    assert r.status_code == 401


def test_health_detailed_rejects_wrong_token(auth_client):
    c, _tok, _uid = auth_client
    r = c.get("/health/detailed", headers={"Authorization": "Bearer wrong-token"})
    assert r.status_code == 401


def test_health_detailed_with_correct_token_returns_full_body(auth_client):
    c, _tok, _uid = auth_client
    r = c.get("/health/detailed", headers=_admin_h())
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["db_type"] in ("sqlite", "postgresql")
    assert body["db_reachable"] is True
    assert body["db_error"] is None
    assert body["cors_origins_configured"] is True
    assert body["jwt_secret_configured"] is True
    assert isinstance(body["sentry_configured"], bool)
    assert body["public_url_configured"] is True


def test_health_detailed_never_leaks_secret_values(auth_client):
    """Double-check: presence-flags only, no raw values anywhere. Even
    behind the gate the response body must not echo any secret."""
    c, _tok, _uid = auth_client
    r = c.get("/health/detailed", headers=_admin_h())
    assert "dev-secret-change-in-production" not in r.text
    assert "test-secret-" not in r.text
    # The token itself must not appear in the response.
    assert os.environ["SNAPSHOT_AUTH_TOKEN"] not in r.text
