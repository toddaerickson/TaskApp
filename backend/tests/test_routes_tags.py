"""Tag route tests."""


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


def test_list_empty_tags(auth_client):
    c, tok, _ = auth_client
    assert c.get("/tags", headers=_h(tok)).json() == []


def test_create_and_list_tags(auth_client):
    c, tok, _ = auth_client
    a = c.post("/tags", headers=_h(tok), json={"name": "urgent"}).json()
    b = c.post("/tags", headers=_h(tok), json={"name": "home"}).json()
    assert a["name"] == "urgent" and a["id"] != b["id"]
    tags = c.get("/tags", headers=_h(tok)).json()
    assert {t["name"] for t in tags} == {"urgent", "home"}


def test_duplicate_tag_is_idempotent(auth_client):
    """Re-creating a tag with the same name returns the existing row
    instead of erroring. Lock that behavior in."""
    c, tok, _ = auth_client
    r1 = c.post("/tags", headers=_h(tok), json={"name": "dup"}).json()
    r2 = c.post("/tags", headers=_h(tok), json={"name": "dup"}).json()
    assert r1["id"] == r2["id"]
    assert len(c.get("/tags", headers=_h(tok)).json()) == 1


def test_delete_tag(auth_client):
    c, tok, _ = auth_client
    t = c.post("/tags", headers=_h(tok), json={"name": "doomed"}).json()
    d = c.delete(f"/tags/{t['id']}", headers=_h(tok))
    assert d.status_code == 200
    assert c.get("/tags", headers=_h(tok)).json() == []


def test_tags_scoped_per_user(client):
    t1 = client.post("/auth/register", json={"email": "u1@x.com", "password": "pw1234567"}).json()["access_token"]
    client.post("/tags", headers=_h(t1), json={"name": "u1"})
    t2 = client.post("/auth/register", json={"email": "u2@x.com", "password": "pw1234567"}).json()["access_token"]
    # Same name allowed for u2 because unique is (user_id, name).
    r = client.post("/tags", headers=_h(t2), json={"name": "u1"})
    assert r.status_code == 200
    u2_tags = client.get("/tags", headers=_h(t2)).json()
    assert len(u2_tags) == 1
