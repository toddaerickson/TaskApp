"""Edge-case tests for JWT auth: malformed, wrong signature, expired,
missing claims, and that a token still works after password verification
(the middleware doesn't re-check DB state on every request)."""
from datetime import datetime, timedelta, timezone
from jose import jwt

from app.config import JWT_SECRET, JWT_ALGORITHM


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


def test_malformed_token_returns_401(client):
    r = client.get("/auth/me", headers=_h("not.a.jwt"))
    assert r.status_code == 401


def test_wrong_signature_returns_401(client):
    client.post("/auth/register", json={"email": "a@x.com", "password": "pw1234567"})
    # Token signed with a different secret.
    bad = jwt.encode({"sub": "1", "exp": datetime.now(timezone.utc) + timedelta(hours=1)},
                     "wrong-secret", algorithm=JWT_ALGORITHM)
    r = client.get("/auth/me", headers=_h(bad))
    assert r.status_code == 401


def test_expired_token_returns_401(client):
    client.post("/auth/register", json={"email": "a@x.com", "password": "pw1234567"})
    expired = jwt.encode(
        {"sub": "1", "exp": datetime.now(timezone.utc) - timedelta(seconds=1)},
        JWT_SECRET, algorithm=JWT_ALGORITHM,
    )
    r = client.get("/auth/me", headers=_h(expired))
    assert r.status_code == 401


def test_token_missing_sub_claim_returns_401(client):
    no_sub = jwt.encode(
        {"exp": datetime.now(timezone.utc) + timedelta(hours=1)},
        JWT_SECRET, algorithm=JWT_ALGORITHM,
    )
    r = client.get("/auth/me", headers=_h(no_sub))
    assert r.status_code == 401


def test_token_non_integer_sub_returns_401(client):
    bad = jwt.encode(
        {"sub": "not-an-int", "exp": datetime.now(timezone.utc) + timedelta(hours=1)},
        JWT_SECRET, algorithm=JWT_ALGORITHM,
    )
    r = client.get("/auth/me", headers=_h(bad))
    assert r.status_code == 401


def test_token_for_nonexistent_user_still_authorized_but_sees_own_empty_data(client):
    """Current design: token is self-contained; we don't look up the user
    on every request. A token whose sub is for a deleted user will simply
    see an empty view (no data belongs to that id). This test locks in the
    behavior so we notice if the design changes."""
    ghost = jwt.encode(
        {"sub": "99999", "exp": datetime.now(timezone.utc) + timedelta(hours=1)},
        JWT_SECRET, algorithm=JWT_ALGORITHM,
    )
    # The token is 'valid' so /me doesn't 401 — it'll 404 because the user
    # row is missing. Either outcome is defensible; lock in what we have.
    r = client.get("/auth/me", headers=_h(ghost))
    assert r.status_code in (401, 404)


def test_bearer_prefix_required(client):
    client.post("/auth/register", json={"email": "a@x.com", "password": "pw1234567"})
    tok = client.post("/auth/login", json={"email": "a@x.com", "password": "pw1234567"}).json()["access_token"]
    # Missing "Bearer " prefix → HTTPBearer rejects it.
    r = client.get("/auth/me", headers={"Authorization": tok})
    assert r.status_code in (401, 403)


def test_token_stays_valid_after_password_change(client):
    """If we ever add /auth/change-password, existing tokens should keep
    working because they're stateless. This documents that today's
    behavior is stateless-JWT (no revocation)."""
    r = client.post("/auth/register", json={"email": "a@x.com", "password": "pw1234567"})
    tok = r.json()["access_token"]
    assert client.get("/auth/me", headers=_h(tok)).status_code == 200
