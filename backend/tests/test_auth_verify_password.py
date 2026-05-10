"""Tests for /auth/verify-password.

This endpoint backs the mobile Reset PIN flow: the device-side PinGate
lockout (5 wrong PIN attempts) can only be escaped by submitting the
user's account password, which the server validates against the
bcrypt hash without changing state.
"""


def _auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_verify_password_happy_path(client):
    r = client.post("/auth/register", json={"email": "u@x.com", "password": "rightpw1234"})
    token = r.json()["access_token"]

    r2 = client.post(
        "/auth/verify-password",
        json={"password": "rightpw1234"},
        headers=_auth_header(token),
    )
    assert r2.status_code == 200
    assert r2.json() == {"ok": True}


def test_verify_password_wrong_returns_401(client):
    r = client.post("/auth/register", json={"email": "u@x.com", "password": "rightpw1234"})
    token = r.json()["access_token"]

    r2 = client.post(
        "/auth/verify-password",
        json={"password": "wrongpw1234"},
        headers=_auth_header(token),
    )
    assert r2.status_code == 401
    # Generic wording — don't tell an attacker whether the password is
    # close, just wrong.
    assert "invalid" in r2.json()["detail"].lower()


def test_verify_password_missing_auth_returns_unauthorized(client):
    # No Authorization header → HTTPBearer rejects before the route
    # body runs. This FastAPI version returns 401 (older fastapi /
    # starlette versions returned 403 here; assert the umbrella
    # "unauthenticated" status family instead of pinning a specific code).
    r = client.post("/auth/verify-password", json={"password": "anything"})
    assert r.status_code in (401, 403)


def test_verify_password_does_not_mutate_state(client):
    """The endpoint is read-only — calling it shouldn't invalidate the
    JWT, change the password, or alter anything about the user. Sanity-
    check by hitting it then continuing to use the same token."""
    r = client.post("/auth/register", json={"email": "u@x.com", "password": "samepw1234"})
    token = r.json()["access_token"]

    client.post(
        "/auth/verify-password",
        json={"password": "samepw1234"},
        headers=_auth_header(token),
    )

    # The token still works on a protected endpoint.
    r2 = client.get("/auth/me", headers=_auth_header(token))
    assert r2.status_code == 200
    assert r2.json()["email"] == "u@x.com"

    # The password is unchanged — original login still works.
    r3 = client.post("/auth/login", json={"email": "u@x.com", "password": "samepw1234"})
    assert r3.status_code == 200
