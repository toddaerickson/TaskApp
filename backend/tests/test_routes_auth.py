def test_register_returns_token(client):
    r = client.post("/auth/register", json={"email": "a@x.com", "password": "pw1234567"})
    assert r.status_code == 200
    assert r.json()["access_token"]


def test_duplicate_register_rejected(client):
    client.post("/auth/register", json={"email": "a@x.com", "password": "pw1234567"})
    r = client.post("/auth/register", json={"email": "a@x.com", "password": "pw1234567"})
    assert r.status_code == 400


def test_login_with_correct_password(client):
    client.post("/auth/register", json={"email": "a@x.com", "password": "pw1234567"})
    r = client.post("/auth/login", json={"email": "a@x.com", "password": "pw1234567"})
    assert r.status_code == 200
    assert r.json()["access_token"]


def test_login_wrong_password(client):
    client.post("/auth/register", json={"email": "a@x.com", "password": "pw1234567"})
    r = client.post("/auth/login", json={"email": "a@x.com", "password": "wrong"})
    assert r.status_code == 401


def test_me_requires_token(client):
    r = client.get("/auth/me")
    # FastAPI HTTPBearer returns 403 by default when no creds, 401 on bad creds.
    assert r.status_code in (401, 403)


def test_me_returns_user(auth_client):
    c, tok, uid = auth_client
    r = c.get("/auth/me", headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 200
    assert r.json()["id"] == uid


def test_register_rejects_invalid_email(client):
    r = client.post("/auth/register", json={"email": "not-an-email", "password": "pw1234567"})
    assert r.status_code == 422
    body = r.json()
    assert any("valid email" in (d.get("msg") or "").lower() for d in body["detail"])


def test_register_rejects_short_password(client):
    r = client.post("/auth/register", json={"email": "a@x.com", "password": "short"})
    assert r.status_code == 422


def test_register_normalizes_email_case_and_whitespace(client):
    r = client.post("/auth/register", json={"email": "  A@X.com  ", "password": "pw1234567"})
    assert r.status_code == 200
    # Re-registration with the normalized form should collide.
    r2 = client.post("/auth/register", json={"email": "a@x.com", "password": "pw1234567"})
    assert r2.status_code == 400


def test_login_normalizes_email(client):
    client.post("/auth/register", json={"email": "a@x.com", "password": "pw1234567"})
    r = client.post("/auth/login", json={"email": "  A@X.com  ", "password": "pw1234567"})
    assert r.status_code == 200


def test_register_strips_display_name(client):
    r = client.post("/auth/register", json={
        "email": "b@x.com", "password": "pw1234567", "display_name": "   Bob   ",
    })
    assert r.status_code == 200
    tok = r.json()["access_token"]
    me = client.get("/auth/me", headers={"Authorization": f"Bearer {tok}"}).json()
    assert me["display_name"] == "Bob"
