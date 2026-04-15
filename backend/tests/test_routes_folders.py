"""Folder + subfolder route tests.

Note: registering a new user auto-creates 8 default GTD folders
(Critical, 1. Capture, 2. Do Now, ...). Tests account for that by
measuring the *delta* rather than absolute list length.
"""


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


# ---------- Folders ----------

def test_new_user_has_default_gtd_folders(auth_client):
    c, tok, _ = auth_client
    names = {f["name"] for f in c.get("/folders", headers=_h(tok)).json()}
    assert "Critical" in names
    assert "1. Capture" in names
    assert "7. Reference" in names


def test_create_folder_adds_to_list(auth_client):
    c, tok, _ = auth_client
    before = len(c.get("/folders", headers=_h(tok)).json())
    a = c.post("/folders", headers=_h(tok), json={"name": "Work"}).json()
    assert a["name"] == "Work"
    after = c.get("/folders", headers=_h(tok)).json()
    assert len(after) == before + 1
    assert any(f["name"] == "Work" for f in after)


def test_update_folder_name_and_sort(auth_client):
    c, tok, _ = auth_client
    f = c.post("/folders", headers=_h(tok), json={"name": "Old"}).json()
    r = c.put(f"/folders/{f['id']}", headers=_h(tok),
              json={"name": "New", "sort_order": 5})
    assert r.status_code == 200
    assert r.json()["name"] == "New"
    assert r.json()["sort_order"] == 5


def test_delete_folder(auth_client):
    c, tok, _ = auth_client
    f = c.post("/folders", headers=_h(tok), json={"name": "Temp"}).json()
    r = c.delete(f"/folders/{f['id']}", headers=_h(tok))
    assert r.status_code == 200
    names = {f["name"] for f in c.get("/folders", headers=_h(tok)).json()}
    assert "Temp" not in names


def test_user2_cannot_see_user1_custom_folder(client):
    t1 = client.post("/auth/register", json={"email": "u1@x.com", "password": "pw1234567"}).json()["access_token"]
    client.post("/folders", headers=_h(t1), json={"name": "u1-secret"})
    t2 = client.post("/auth/register", json={"email": "u2@x.com", "password": "pw1234567"}).json()["access_token"]
    names = {f["name"] for f in client.get("/folders", headers=_h(t2)).json()}
    # Defaults exist for u2 too; u1's custom folder must not leak across.
    assert "u1-secret" not in names


def test_user2_cannot_update_user1_folder(client):
    t1 = client.post("/auth/register", json={"email": "u1@x.com", "password": "pw1234567"}).json()["access_token"]
    f = client.post("/folders", headers=_h(t1), json={"name": "mine"}).json()
    t2 = client.post("/auth/register", json={"email": "u2@x.com", "password": "pw1234567"}).json()["access_token"]
    r = client.put(f"/folders/{f['id']}", headers=_h(t2), json={"name": "hax"})
    assert r.status_code == 404


# ---------- Subfolders ----------

def test_create_and_list_subfolders(auth_client):
    c, tok, _ = auth_client
    f = c.post("/folders", headers=_h(tok), json={"name": "Work"}).json()
    s = c.post(f"/folders/{f['id']}/subfolders", headers=_h(tok),
               json={"name": "Clients"}).json()
    assert s["folder_id"] == f["id"]
    assert s["name"] == "Clients"
    listed = c.get(f"/folders/{f['id']}/subfolders", headers=_h(tok)).json()
    assert [x["name"] for x in listed] == ["Clients"]


def test_subfolder_update_and_delete(auth_client):
    c, tok, _ = auth_client
    f = c.post("/folders", headers=_h(tok), json={"name": "Work"}).json()
    s = c.post(f"/folders/{f['id']}/subfolders", headers=_h(tok),
               json={"name": "Old"}).json()
    upd = c.put(f"/subfolders/{s['id']}", headers=_h(tok),
                json={"name": "New"})
    assert upd.status_code == 200
    assert upd.json()["name"] == "New"
    d = c.delete(f"/subfolders/{s['id']}", headers=_h(tok))
    assert d.status_code == 200
    assert c.get(f"/folders/{f['id']}/subfolders", headers=_h(tok)).json() == []


def test_subfolder_scoped_to_its_folder_owner(client):
    t1 = client.post("/auth/register", json={"email": "u1@x.com", "password": "pw1234567"}).json()["access_token"]
    f = client.post("/folders", headers=_h(t1), json={"name": "f"}).json()
    s = client.post(f"/folders/{f['id']}/subfolders", headers=_h(t1),
                    json={"name": "s"}).json()
    t2 = client.post("/auth/register", json={"email": "u2@x.com", "password": "pw1234567"}).json()["access_token"]
    # User 2 cannot list user 1's folder's subfolders.
    r = client.get(f"/folders/{f['id']}/subfolders", headers=_h(t2))
    assert r.status_code in (403, 404) or r.json() == []
    # User 2 cannot update/delete user 1's subfolder.
    r2 = client.put(f"/subfolders/{s['id']}", headers=_h(t2), json={"name": "hax"})
    assert r2.status_code == 404
    r3 = client.delete(f"/subfolders/{s['id']}", headers=_h(t2))
    assert r3.status_code == 404


def test_cannot_add_subfolder_to_nonexistent_folder(auth_client):
    c, tok, _ = auth_client
    r = c.post("/folders/99999/subfolders", headers=_h(tok), json={"name": "s"})
    assert r.status_code == 404
