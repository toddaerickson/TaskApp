"""Tests for /auth/change-password and PUT /auth/me (profile edit).

These two endpoints form the backend of the Settings → Account sub-screen.
Change-password verifies the current hash via bcrypt, rehashes, and rotates.
Profile PUT only touches display_name.
"""


def _auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_change_password_happy_path_allows_reauth(client):
    r = client.post("/auth/register", json={"email": "u@x.com", "password": "oldpw1234"})
    token = r.json()["access_token"]

    r2 = client.post(
        "/auth/change-password",
        json={"current_password": "oldpw1234", "new_password": "newpw5678"},
        headers=_auth_header(token),
    )
    assert r2.status_code == 200
    assert r2.json() == {"ok": True}

    # Old password is now invalid.
    r3 = client.post("/auth/login", json={"email": "u@x.com", "password": "oldpw1234"})
    assert r3.status_code == 401

    # New password logs in cleanly.
    r4 = client.post("/auth/login", json={"email": "u@x.com", "password": "newpw5678"})
    assert r4.status_code == 200
    assert "access_token" in r4.json()


def test_change_password_wrong_current_returns_401(client):
    r = client.post("/auth/register", json={"email": "u@x.com", "password": "realpw1234"})
    token = r.json()["access_token"]

    r2 = client.post(
        "/auth/change-password",
        json={"current_password": "wrongpw!!!", "new_password": "newpw5678"},
        headers=_auth_header(token),
    )
    assert r2.status_code == 401

    # Original password still works.
    r3 = client.post("/auth/login", json={"email": "u@x.com", "password": "realpw1234"})
    assert r3.status_code == 200


def test_change_password_weak_new_returns_422(client):
    r = client.post("/auth/register", json={"email": "u@x.com", "password": "oldpw1234"})
    token = r.json()["access_token"]

    r2 = client.post(
        "/auth/change-password",
        json={"current_password": "oldpw1234", "new_password": "short"},
        headers=_auth_header(token),
    )
    assert r2.status_code == 422


def test_change_password_requires_auth(client):
    r = client.post(
        "/auth/change-password",
        json={"current_password": "x", "new_password": "newpw5678"},
    )
    assert r.status_code == 401


def test_profile_put_updates_display_name(client):
    r = client.post("/auth/register", json={"email": "u@x.com", "password": "pw12345!"})
    token = r.json()["access_token"]

    r2 = client.put(
        "/auth/me",
        json={"display_name": "Alice"},
        headers=_auth_header(token),
    )
    assert r2.status_code == 200
    body = r2.json()
    assert body["display_name"] == "Alice"
    assert body["email"] == "u@x.com"

    # GET /auth/me sees the update.
    r3 = client.get("/auth/me", headers=_auth_header(token))
    assert r3.json()["display_name"] == "Alice"


def test_profile_put_trims_whitespace_and_collapses_empty(client):
    r = client.post("/auth/register", json={"email": "u@x.com", "password": "pw12345!"})
    token = r.json()["access_token"]

    r2 = client.put(
        "/auth/me",
        json={"display_name": "   "},
        headers=_auth_header(token),
    )
    assert r2.status_code == 200
    # Whitespace-only normalized to null, matching RegisterRequest's rule.
    assert r2.json()["display_name"] is None

    r3 = client.put(
        "/auth/me",
        json={"display_name": "  Bob  "},
        headers=_auth_header(token),
    )
    assert r3.status_code == 200
    assert r3.json()["display_name"] == "Bob"


def test_profile_put_requires_auth(client):
    r = client.put("/auth/me", json={"display_name": "Alice"})
    assert r.status_code == 401
