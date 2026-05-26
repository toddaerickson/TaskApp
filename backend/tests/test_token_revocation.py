"""JWT revocation via users.token_version (PR-Y14).

A leaked 30-day JWT used to be uninvalidatable without rotating
JWT_SECRET (which would log the legit user out too). Each user now
carries a token_version counter; the JWT encodes it in the `ver` claim;
get_current_user_id rejects on mismatch. Bumps happen on
change-password success and on /auth/sign-out-everywhere.
"""
from datetime import datetime, timedelta, timezone

from jose import jwt

from app.config import JWT_ALGORITHM, JWT_SECRET
from app.database import get_db


def _auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _register_and_get_token(client, email: str = "tv@x.com", password: str = "pw12345!") -> str:
    r = client.post("/auth/register", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def _read_token_version(user_id: int) -> int:
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT token_version FROM users WHERE id = ?", (user_id,))
        return cur.fetchone()["token_version"]


def _user_id_for(email: str) -> int:
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT id FROM users WHERE email = ?", (email,))
        return cur.fetchone()["id"]


def test_register_issues_token_with_ver_claim(client):
    token = _register_and_get_token(client)
    payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    assert payload["ver"] == 0


def test_login_issues_token_matching_current_token_version(client):
    _register_and_get_token(client)
    uid = _user_id_for("tv@x.com")
    # Bump the version directly to simulate a prior sign-out-everywhere.
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("UPDATE users SET token_version = 7 WHERE id = ?", (uid,))

    r = client.post("/auth/login", json={"email": "tv@x.com", "password": "pw12345!"})
    assert r.status_code == 200
    payload = jwt.decode(r.json()["access_token"], JWT_SECRET, algorithms=[JWT_ALGORITHM])
    assert payload["ver"] == 7


def test_token_with_wrong_ver_claim_rejected(client):
    _register_and_get_token(client)
    uid = _user_id_for("tv@x.com")
    # Forge a token with a wrong ver (server-side counter is still 0).
    bad = jwt.encode(
        {
            "sub": str(uid),
            "exp": datetime.now(timezone.utc) + timedelta(hours=1),
            "ver": 99,
        },
        JWT_SECRET,
        algorithm=JWT_ALGORITHM,
    )
    r = client.get("/auth/me", headers=_auth_header(bad))
    assert r.status_code == 401


def test_legacy_token_without_ver_claim_still_validates(client):
    # Existing 30-day sessions issued before PR-Y14 lack the `ver` claim.
    # They should continue working until natural expiry as long as the
    # user's server-side token_version is still 0 (its default).
    _register_and_get_token(client)
    uid = _user_id_for("tv@x.com")
    legacy = jwt.encode(
        {
            "sub": str(uid),
            "exp": datetime.now(timezone.utc) + timedelta(hours=1),
        },
        JWT_SECRET,
        algorithm=JWT_ALGORITHM,
    )
    r = client.get("/auth/me", headers=_auth_header(legacy))
    assert r.status_code == 200


def test_change_password_bumps_version_and_issues_fresh_token(client):
    old_token = _register_and_get_token(client)
    uid = _user_id_for("tv@x.com")
    assert _read_token_version(uid) == 0

    r = client.post(
        "/auth/change-password",
        json={"current_password": "pw12345!", "new_password": "newpw678!"},
        headers=_auth_header(old_token),
    )
    assert r.status_code == 200, r.text
    new_token = r.json()["access_token"]

    # Server-side counter incremented.
    assert _read_token_version(uid) == 1

    # The returned token has the new version and still works.
    payload = jwt.decode(new_token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    assert payload["ver"] == 1
    me = client.get("/auth/me", headers=_auth_header(new_token))
    assert me.status_code == 200

    # The OLD token is now dead (would still be sitting on other devices).
    dead = client.get("/auth/me", headers=_auth_header(old_token))
    assert dead.status_code == 401


def test_sign_out_everywhere_returns_204_and_invalidates_caller(client):
    token = _register_and_get_token(client)
    uid = _user_id_for("tv@x.com")
    assert _read_token_version(uid) == 0

    r = client.post("/auth/sign-out-everywhere", headers=_auth_header(token))
    assert r.status_code == 204
    assert r.content == b""

    # Version bumped; current caller's token now 401s.
    assert _read_token_version(uid) == 1
    dead = client.get("/auth/me", headers=_auth_header(token))
    assert dead.status_code == 401


def test_sign_out_everywhere_requires_auth(client):
    r = client.post("/auth/sign-out-everywhere")
    assert r.status_code == 401
