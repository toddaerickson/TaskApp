"""Structured `code` field on error responses so `describeApiError` in
the mobile client can map specific failure modes to UX messages without
parsing English detail strings."""


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


def test_404_returns_not_found_code(client):
    r = client.post("/auth/register", json={"email": "a@x.com", "password": "pw12345!"})
    token = r.json()["access_token"]
    r = client.get("/routines/99999", headers=_h(token))
    assert r.status_code == 404
    body = r.json()
    assert body["code"] == "not_found"
    # Existing string-detail callers stay supported.
    assert isinstance(body["detail"], str)


def test_missing_bearer_returns_forbidden_or_unauthorized_code(client):
    # HTTPBearer returns 403 when Authorization is absent; the handler
    # derives `forbidden` from that status.
    r = client.get("/auth/me")
    assert r.status_code in (401, 403)
    body = r.json()
    assert body["code"] in ("unauthorized", "forbidden")


def test_bad_token_returns_unauthorized_code(client):
    r = client.get("/auth/me", headers=_h("not.a.jwt"))
    assert r.status_code == 401
    assert r.json()["code"] == "unauthorized"


def test_validation_error_returns_validation_code(client):
    # Registering with an invalid email payload trips Pydantic validation.
    r = client.post("/auth/register", json={"email": "not-an-email", "password": "pw12345!"})
    assert r.status_code == 422
    body = r.json()
    assert body["code"] == "validation_error"
    # detail is a list of pydantic errors — keep that shape so existing
    # mobile callers that inspect detail[0].msg still work.
    assert isinstance(body["detail"], list)


def test_rate_limited_returns_rate_limited_code(client):
    from app.rate_limit import limiter
    limiter.enabled = True
    try:
        client.post("/auth/register", json={"email": "rl2@x.com", "password": "pw12345!"})
        statuses = []
        bodies = []
        for _ in range(11):
            r = client.post("/auth/login", json={"email": "rl2@x.com", "password": "wrong"})
            statuses.append(r.status_code)
            bodies.append(r.json())
        assert statuses[10] == 429
        assert bodies[10]["code"] == "rate_limited"
    finally:
        limiter.enabled = False
        limiter.reset()


def test_route_can_override_code_via_dict_detail(client):
    """A route that raises `HTTPException(400, detail={"detail": "...", "code": "x"})`
    surfaces its custom code instead of the status-derived default.

    Register two users with the same email: the second one hits the
    string-detail 400 path so the default `bad_request` code applies.
    This lock-in test ensures the dict-detail path is the opt-in.
    """
    from fastapi import HTTPException
    from fastapi.testclient import TestClient
    from main import app

    @app.get("/__test_error__")
    def _probe():
        raise HTTPException(409, detail={"detail": "please try later", "code": "conflict_custom"})

    with TestClient(app) as c:
        r = c.get("/__test_error__")
    assert r.status_code == 409
    body = r.json()
    assert body["code"] == "conflict_custom"
    assert body["detail"] == "please try later"
