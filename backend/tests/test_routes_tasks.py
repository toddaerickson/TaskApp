"""Task-route tests: CRUD, filters, complete, reorder, batch, tag attach."""


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


# ---------- Create / read / update / delete ----------

def test_create_minimal_task(auth_client):
    c, tok, _ = auth_client
    r = c.post("/tasks", headers=_h(tok), json={"title": "Buy milk"})
    assert r.status_code == 200
    body = r.json()
    assert body["title"] == "Buy milk"
    assert body["completed"] is False
    assert body["priority"] == 0
    assert body["starred"] is False


def test_create_with_all_fields(auth_client):
    c, tok, _ = auth_client
    r = c.post("/tasks", headers=_h(tok), json={
        "title": "Call dentist", "note": "ask about insurance",
        "priority": 2, "starred": True, "status": "next_action",
        "due_date": "2026-05-01",
    })
    assert r.status_code == 200
    body = r.json()
    assert body["priority"] == 2
    assert body["starred"] is True
    assert body["status"] == "next_action"
    assert body["due_date"] == "2026-05-01"


def test_update_task_partial(auth_client):
    c, tok, _ = auth_client
    t = c.post("/tasks", headers=_h(tok), json={"title": "Orig"}).json()
    r = c.put(f"/tasks/{t['id']}", headers=_h(tok),
              json={"title": "Renamed", "priority": 3})
    assert r.status_code == 200
    assert r.json()["title"] == "Renamed"
    assert r.json()["priority"] == 3


def test_delete_task(auth_client):
    c, tok, _ = auth_client
    t = c.post("/tasks", headers=_h(tok), json={"title": "Doomed"}).json()
    r = c.delete(f"/tasks/{t['id']}", headers=_h(tok))
    assert r.status_code == 200
    assert c.get(f"/tasks/{t['id']}", headers=_h(tok)).status_code == 404


def test_user2_cannot_see_or_edit_user1_task(client):
    t1 = client.post("/auth/register", json={"email": "u1@x.com", "password": "pw1234567"}).json()["access_token"]
    task = client.post("/tasks", headers=_h(t1), json={"title": "mine"}).json()
    t2 = client.post("/auth/register", json={"email": "u2@x.com", "password": "pw1234567"}).json()["access_token"]
    assert client.get(f"/tasks/{task['id']}", headers=_h(t2)).status_code == 404
    assert client.put(f"/tasks/{task['id']}", headers=_h(t2), json={"title": "hax"}).status_code == 404
    assert client.delete(f"/tasks/{task['id']}", headers=_h(t2)).status_code == 404


# ---------- Complete ----------

def test_complete_task_sets_flag_and_timestamp(auth_client):
    c, tok, _ = auth_client
    t = c.post("/tasks", headers=_h(tok), json={"title": "Do it"}).json()
    r = c.post(f"/tasks/{t['id']}/complete", headers=_h(tok))
    assert r.status_code == 200
    body = r.json()
    assert body["completed"] is True
    assert body["completed_at"] is not None


def test_uncomplete_task_clears_flag_and_timestamp(auth_client):
    """Symmetric to /complete: the Tasks tab's Completed filter view
    needs an un-check action so the user can move a row back to the
    active list without opening the detail screen."""
    c, tok, _ = auth_client
    t = c.post("/tasks", headers=_h(tok), json={"title": "Flip"}).json()
    c.post(f"/tasks/{t['id']}/complete", headers=_h(tok))
    completed = c.get(f"/tasks/{t['id']}", headers=_h(tok)).json()
    assert completed["completed"] is True
    assert completed["completed_at"] is not None

    r = c.post(f"/tasks/{t['id']}/uncomplete", headers=_h(tok))
    assert r.status_code == 200
    body = r.json()
    assert body["completed"] is False
    assert body["completed_at"] is None


def test_uncomplete_is_idempotent_on_already_active_task(auth_client):
    """Double-tap protection: the mobile toggle is allowed to call
    /uncomplete on a task that's already not-completed without 4xx —
    keeps optimistic-UI rollback simple."""
    c, tok, _ = auth_client
    t = c.post("/tasks", headers=_h(tok), json={"title": "Active"}).json()
    r = c.post(f"/tasks/{t['id']}/uncomplete", headers=_h(tok))
    assert r.status_code == 200
    assert r.json()["completed"] is False


def test_uncomplete_404_for_other_users_task(auth_client, client):
    """Auth check: posting /uncomplete against another user's task id
    should 404 like every other ownership-scoped route."""
    c, tok, _ = auth_client
    t = c.post("/tasks", headers=_h(tok), json={"title": "Mine"}).json()
    # Register a second user via the bare client.
    r = client.post("/auth/register", json={"email": "other@x.com", "password": "pw12345!"})
    other_tok = r.json()["access_token"]
    r = client.post(f"/tasks/{t['id']}/uncomplete", headers=_h(other_tok))
    assert r.status_code == 404


# ---------- Filters ----------

def test_filter_by_folder(auth_client):
    c, tok, _ = auth_client
    fa = c.post("/folders", headers=_h(tok), json={"name": "FolderA"}).json()
    fb = c.post("/folders", headers=_h(tok), json={"name": "FolderB"}).json()
    c.post("/tasks", headers=_h(tok), json={"title": "in A", "folder_id": fa["id"]})
    c.post("/tasks", headers=_h(tok), json={"title": "in B", "folder_id": fb["id"]})
    r = c.get("/tasks", headers=_h(tok), params={"folder_id": fa["id"]}).json()
    titles = [t["title"] for t in r["tasks"]]
    assert "in A" in titles and "in B" not in titles


def test_filter_by_completed(auth_client):
    c, tok, _ = auth_client
    c.post("/tasks", headers=_h(tok), json={"title": "open"})
    b = c.post("/tasks", headers=_h(tok), json={"title": "done"}).json()
    c.post(f"/tasks/{b['id']}/complete", headers=_h(tok))

    active = c.get("/tasks", headers=_h(tok), params={"completed": "false"}).json()
    done = c.get("/tasks", headers=_h(tok), params={"completed": "true"}).json()
    assert {t["title"] for t in active["tasks"]} == {"open"}
    assert {t["title"] for t in done["tasks"]} == {"done"}


def test_filter_by_starred_and_priority(auth_client):
    c, tok, _ = auth_client
    c.post("/tasks", headers=_h(tok), json={"title": "a", "starred": True, "priority": 3})
    c.post("/tasks", headers=_h(tok), json={"title": "b", "starred": False, "priority": 3})
    c.post("/tasks", headers=_h(tok), json={"title": "c", "starred": True, "priority": 0})

    starred = c.get("/tasks", headers=_h(tok), params={"starred": "true"}).json()
    assert {t["title"] for t in starred["tasks"]} == {"a", "c"}
    top = c.get("/tasks", headers=_h(tok), params={"priority": 3}).json()
    assert {t["title"] for t in top["tasks"]} == {"a", "b"}


def test_filter_search(auth_client):
    c, tok, _ = auth_client
    c.post("/tasks", headers=_h(tok), json={"title": "Buy milk"})
    c.post("/tasks", headers=_h(tok), json={"title": "Call dentist"})
    r = c.get("/tasks", headers=_h(tok), params={"search": "dent"}).json()
    assert [t["title"] for t in r["tasks"]] == ["Call dentist"]


# ---------- Reorder + batch ----------

def test_reorder_endpoint(auth_client):
    c, tok, _ = auth_client
    a = c.post("/tasks", headers=_h(tok), json={"title": "a"}).json()
    b = c.post("/tasks", headers=_h(tok), json={"title": "b"}).json()
    cc = c.post("/tasks", headers=_h(tok), json={"title": "c"}).json()
    r = c.post("/tasks/reorder", headers=_h(tok),
               json={"task_ids": [cc["id"], a["id"], b["id"]]})
    assert r.status_code == 200


def test_batch_mark_completed(auth_client):
    c, tok, _ = auth_client
    ids = [c.post("/tasks", headers=_h(tok), json={"title": f"t{i}"}).json()["id"] for i in range(3)]
    r = c.post("/tasks/batch", headers=_h(tok),
               json={"task_ids": ids, "completed": True})
    assert r.status_code == 200
    listed = c.get("/tasks", headers=_h(tok), params={"completed": "true"}).json()
    returned_ids = {t["id"] for t in listed["tasks"]}
    assert set(ids).issubset(returned_ids)


def test_batch_move_to_folder(auth_client):
    c, tok, _ = auth_client
    f = c.post("/folders", headers=_h(tok), json={"name": "Bucket"}).json()
    ids = [c.post("/tasks", headers=_h(tok), json={"title": f"t{i}"}).json()["id"] for i in range(3)]
    r = c.post("/tasks/batch", headers=_h(tok),
               json={"task_ids": ids, "folder_id": f["id"]})
    assert r.status_code == 200
    listed = c.get("/tasks", headers=_h(tok), params={"folder_id": f["id"]}).json()
    assert {t["id"] for t in listed["tasks"]} == set(ids)


# ---------- Tag attachment ----------

def test_attach_tags_on_create(auth_client):
    c, tok, _ = auth_client
    t1 = c.post("/tags", headers=_h(tok), json={"name": "urgent"}).json()
    t2 = c.post("/tags", headers=_h(tok), json={"name": "home"}).json()
    t = c.post("/tasks", headers=_h(tok), json={
        "title": "Tagged", "tag_ids": [t1["id"], t2["id"]],
    }).json()
    assert {tg["name"] for tg in t["tags"]} == {"urgent", "home"}


def test_update_tags_replaces_set(auth_client):
    c, tok, _ = auth_client
    a = c.post("/tags", headers=_h(tok), json={"name": "a"}).json()
    b = c.post("/tags", headers=_h(tok), json={"name": "b"}).json()
    t = c.post("/tasks", headers=_h(tok), json={
        "title": "Tagged", "tag_ids": [a["id"]],
    }).json()
    upd = c.put(f"/tasks/{t['id']}", headers=_h(tok),
                json={"tag_ids": [b["id"]]}).json()
    assert {tg["name"] for tg in upd["tags"]} == {"b"}
