"""Reminder route tests."""


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


def _task(c, tok, title="t"):
    return c.post("/tasks", headers=_h(tok), json={"title": title}).json()


# ---------- Create + list ----------

def test_create_reminder_for_task(auth_client):
    c, tok, _ = auth_client
    t = _task(c, tok)
    r = c.post(f"/tasks/{t['id']}/reminders", headers=_h(tok),
               json={"remind_at": "2026-05-01T08:00:00Z"})
    assert r.status_code == 200
    assert r.json()["task_id"] == t["id"]
    assert r.json()["reminded"] is False


def test_reminder_for_missing_task_404s(auth_client):
    c, tok, _ = auth_client
    r = c.post("/tasks/99999/reminders", headers=_h(tok),
               json={"remind_at": "2026-05-01T08:00:00Z"})
    assert r.status_code == 404


def test_list_reminders_for_task(auth_client):
    c, tok, _ = auth_client
    t = _task(c, tok)
    c.post(f"/tasks/{t['id']}/reminders", headers=_h(tok),
           json={"remind_at": "2026-05-01T08:00:00Z"})
    c.post(f"/tasks/{t['id']}/reminders", headers=_h(tok),
           json={"remind_at": "2026-05-02T08:00:00Z"})
    arr = c.get(f"/tasks/{t['id']}/reminders", headers=_h(tok)).json()
    assert len(arr) == 2
    # Ordered ascending by remind_at.
    assert arr[0]["remind_at"] < arr[1]["remind_at"]


def test_user2_cannot_add_reminder_to_user1_task(client):
    t1 = client.post("/auth/register", json={"email": "u1@x.com", "password": "pw1234567"}).json()["access_token"]
    task = client.post("/tasks", headers=_h(t1), json={"title": "u1"}).json()
    t2 = client.post("/auth/register", json={"email": "u2@x.com", "password": "pw1234567"}).json()["access_token"]
    r = client.post(f"/tasks/{task['id']}/reminders", headers=_h(t2),
                    json={"remind_at": "2026-05-01T08:00:00Z"})
    assert r.status_code == 404


# ---------- Delete ----------

def test_delete_reminder(auth_client):
    c, tok, _ = auth_client
    t = _task(c, tok)
    rem = c.post(f"/tasks/{t['id']}/reminders", headers=_h(tok),
                 json={"remind_at": "2026-05-01T08:00:00Z"}).json()
    d = c.delete(f"/reminders/{rem['id']}", headers=_h(tok))
    assert d.status_code == 200
    assert c.get(f"/tasks/{t['id']}/reminders", headers=_h(tok)).json() == []


def test_user2_cannot_delete_user1_reminder(client):
    t1 = client.post("/auth/register", json={"email": "u1@x.com", "password": "pw1234567"}).json()["access_token"]
    task = client.post("/tasks", headers=_h(t1), json={"title": "u1"}).json()
    rem = client.post(f"/tasks/{task['id']}/reminders", headers=_h(t1),
                      json={"remind_at": "2026-05-01T08:00:00Z"}).json()
    t2 = client.post("/auth/register", json={"email": "u2@x.com", "password": "pw1234567"}).json()["access_token"]
    r = client.delete(f"/reminders/{rem['id']}", headers=_h(t2))
    assert r.status_code == 404


# ---------- Upcoming ----------

def test_upcoming_returns_undelivered_per_user(client):
    t1 = client.post("/auth/register", json={"email": "u1@x.com", "password": "pw1234567"}).json()["access_token"]
    task = client.post("/tasks", headers=_h(t1), json={"title": "u1"}).json()
    client.post(f"/tasks/{task['id']}/reminders", headers=_h(t1),
                json={"remind_at": "2026-05-01T08:00:00Z"})
    client.post(f"/tasks/{task['id']}/reminders", headers=_h(t1),
                json={"remind_at": "2026-05-02T08:00:00Z"})
    # User 2 should see nothing.
    t2 = client.post("/auth/register", json={"email": "u2@x.com", "password": "pw1234567"}).json()["access_token"]
    assert client.get("/reminders/upcoming", headers=_h(t2)).json() == []
    # User 1 sees both.
    u1 = client.get("/reminders/upcoming", headers=_h(t1)).json()
    assert len(u1) == 2


def test_upcoming_respects_limit(auth_client):
    c, tok, _ = auth_client
    t = _task(c, tok)
    for i in range(5):
        c.post(f"/tasks/{t['id']}/reminders", headers=_h(tok),
               json={"remind_at": f"2026-05-{i + 1:02d}T08:00:00Z"})
    assert len(c.get("/reminders/upcoming", headers=_h(tok), params={"limit": 2}).json()) == 2


# ---------- Cascade ----------

def test_deleting_task_cascades_reminders(auth_client):
    c, tok, _ = auth_client
    t = _task(c, tok)
    c.post(f"/tasks/{t['id']}/reminders", headers=_h(tok),
           json={"remind_at": "2026-05-01T08:00:00Z"})
    c.delete(f"/tasks/{t['id']}", headers=_h(tok))
    # The reminder should be gone (FK ON DELETE CASCADE).
    assert c.get("/reminders/upcoming", headers=_h(tok)).json() == []
