"""Phase 5 auth tests:
  - legacy SHA-256 stored hashes still verify (backward compat)
  - successful login upgrades legacy hashes to bcrypt in place
  - /auth/login is rate-limited to 10/min/IP when the limiter is on
"""
import hashlib
import secrets

from app.database import get_db


def _legacy_sha256_hash(password: str) -> str:
    salt = secrets.token_hex(16)
    return f"{salt}${hashlib.sha256((salt + password).encode()).hexdigest()}"


def _make_user_with_legacy_hash(client, email: str, password: str) -> int:
    # Go straight to the DB so we can seed a SHA-256 row (the register
    # endpoint now writes bcrypt). Register handles folder creation; we skip
    # that here because the test only cares about the auth path.
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO users (email, password_hash, display_name) VALUES (?, ?, ?)",
            (email, _legacy_sha256_hash(password), None),
        )
        return cur.lastrowid


def test_legacy_sha256_login_still_works(client):
    _make_user_with_legacy_hash(client, "legacy@x.com", "hunter22!")
    r = client.post("/auth/login", json={"email": "legacy@x.com", "password": "hunter22!"})
    assert r.status_code == 200
    assert "access_token" in r.json()


def test_legacy_login_rehashes_to_bcrypt(client):
    _make_user_with_legacy_hash(client, "legacy@x.com", "hunter22!")

    # Sanity: the seeded hash is the SHA-256 form.
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT password_hash FROM users WHERE email = ?", ("legacy@x.com",))
        before = cur.fetchone()["password_hash"]
    assert not before.startswith("$2")

    ok = client.post("/auth/login", json={"email": "legacy@x.com", "password": "hunter22!"})
    assert ok.status_code == 200

    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT password_hash FROM users WHERE email = ?", ("legacy@x.com",))
        after = cur.fetchone()["password_hash"]
    assert after.startswith("$2"), f"expected bcrypt prefix after login, got {after[:4]!r}"

    # Another login with the same password still succeeds against the new
    # bcrypt hash — confirms verify and the upgrade round-tripped cleanly.
    again = client.post("/auth/login", json={"email": "legacy@x.com", "password": "hunter22!"})
    assert again.status_code == 200


def test_login_rate_limited(client, rate_limit_on):
    client.post("/auth/register", json={"email": "rl@x.com", "password": "pw12345!"})
    statuses = []
    for _ in range(11):
        r = client.post("/auth/login", json={"email": "rl@x.com", "password": "wrong"})
        statuses.append(r.status_code)
    assert statuses[:10] == [401] * 10, statuses
    assert statuses[10] == 429, statuses


def test_register_rate_limited(client, rate_limit_on):
    statuses = []
    for i in range(6):
        r = client.post(
            "/auth/register",
            json={"email": f"reg{i}@x.com", "password": "pw12345!"},
        )
        statuses.append(r.status_code)
    assert statuses[:5] == [200] * 5, statuses
    assert statuses[5] == 429, statuses


def test_change_password_rate_limited(client, rate_limit_on):
    # slowapi keys per (route, IP), so the register/login during setup
    # consume the /register and /login buckets — not /change-password's.
    client.post("/auth/register", json={"email": "cp@x.com", "password": "pw12345!"})
    tok = client.post(
        "/auth/login", json={"email": "cp@x.com", "password": "pw12345!"}
    ).json()["access_token"]
    headers = {"Authorization": f"Bearer {tok}"}

    statuses = []
    for _ in range(6):
        r = client.post(
            "/auth/change-password",
            json={"current_password": "wrong", "new_password": "pw_new99!"},
            headers=headers,
        )
        statuses.append(r.status_code)
    assert statuses[:5] == [401] * 5, statuses
    assert statuses[5] == 429, statuses


def test_xff_header_does_not_bypass_limiter(client, rate_limit_on):
    """Spoofing X-Forwarded-For must not give an attacker fresh buckets.
    Our key_func reads Fly-Client-IP (set by Fly's edge, not user) and
    falls back to the socket peer — never XFF."""
    client.post("/auth/register", json={"email": "xff@x.com", "password": "pw12345!"})
    statuses = []
    for i in range(11):
        r = client.post(
            "/auth/login",
            json={"email": "xff@x.com", "password": "wrong"},
            headers={"X-Forwarded-For": f"203.0.113.{i}"},
        )
        statuses.append(r.status_code)
    assert statuses[:10] == [401] * 10, statuses
    assert statuses[10] == 429, statuses
