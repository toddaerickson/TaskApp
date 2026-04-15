"""Additional session-route coverage: set deletion, symptom logs, session
update/delete, and symptom-to-session linking."""


def _h(token):
    return {"Authorization": f"Bearer {token}"}


def _start(c, tok, ex_id):
    r = c.post("/routines", headers=_h(tok), json={
        "name": "T",
        "exercises": [{"exercise_id": ex_id, "target_sets": 3, "target_reps": 10}],
    }).json()
    s = c.post("/sessions", headers=_h(tok), json={"routine_id": r["id"]}).json()
    return r["id"], s["id"]


# ---------- Set deletion ----------

def test_delete_set_removes_from_session(auth_client, seeded_globals):
    c, tok, _ = auth_client
    _, sid = _start(c, tok, seeded_globals["bridge"])
    s1 = c.post(f"/sessions/{sid}/sets", headers=_h(tok),
                json={"exercise_id": seeded_globals["bridge"], "reps": 12}).json()
    s2 = c.post(f"/sessions/{sid}/sets", headers=_h(tok),
                json={"exercise_id": seeded_globals["bridge"], "reps": 13}).json()
    r = c.delete(f"/sessions/sets/{s1['id']}", headers=_h(tok))
    assert r.status_code == 200
    sess = c.get(f"/sessions/{sid}", headers=_h(tok)).json()
    assert len(sess["sets"]) == 1
    assert sess["sets"][0]["id"] == s2["id"]


def test_delete_other_users_set_blocked(client, seeded_globals):
    t1 = client.post("/auth/register", json={"email": "u1@x.com", "password": "pw1234567"}).json()["access_token"]
    _, sid = _start(client, t1, seeded_globals["bridge"])
    s = client.post(f"/sessions/{sid}/sets", headers=_h(t1),
                    json={"exercise_id": seeded_globals["bridge"], "reps": 10}).json()
    t2 = client.post("/auth/register", json={"email": "u2@x.com", "password": "pw1234567"}).json()["access_token"]
    r = client.delete(f"/sessions/sets/{s['id']}", headers=_h(t2))
    assert r.status_code == 404


# ---------- Session update / delete ----------

def test_update_session_partial_fields(auth_client, seeded_globals):
    c, tok, _ = auth_client
    _, sid = _start(c, tok, seeded_globals["bridge"])
    r = c.put(f"/sessions/{sid}", headers=_h(tok), json={"rpe": 8})
    assert r.status_code == 200
    assert r.json()["rpe"] == 8
    assert r.json()["ended_at"] is None  # untouched


def test_delete_session_cascades_sets(auth_client, seeded_globals):
    c, tok, _ = auth_client
    _, sid = _start(c, tok, seeded_globals["bridge"])
    c.post(f"/sessions/{sid}/sets", headers=_h(tok),
           json={"exercise_id": seeded_globals["bridge"], "reps": 10})
    r = c.delete(f"/sessions/{sid}", headers=_h(tok))
    assert r.status_code == 200
    r2 = c.get(f"/sessions/{sid}", headers=_h(tok))
    assert r2.status_code == 404


def test_user2_cannot_update_user1_session(client, seeded_globals):
    t1 = client.post("/auth/register", json={"email": "u1@x.com", "password": "pw1234567"}).json()["access_token"]
    _, sid = _start(client, t1, seeded_globals["bridge"])
    t2 = client.post("/auth/register", json={"email": "u2@x.com", "password": "pw1234567"}).json()["access_token"]
    r = client.put(f"/sessions/{sid}", headers=_h(t2), json={"rpe": 9})
    assert r.status_code == 404


# ---------- Symptom logs ----------

def test_create_symptom_and_list(auth_client):
    c, tok, _ = auth_client
    r = c.post("/symptoms", headers=_h(tok),
               json={"body_part": "right_big_toe", "severity": 4, "notes": "tight"})
    assert r.status_code == 200
    r2 = c.get("/symptoms", headers=_h(tok))
    assert r2.status_code == 200
    arr = r2.json()
    assert len(arr) == 1
    assert arr[0]["severity"] == 4


def test_symptom_filtered_by_body_part(auth_client):
    c, tok, _ = auth_client
    c.post("/symptoms", headers=_h(tok), json={"body_part": "right_big_toe", "severity": 3})
    c.post("/symptoms", headers=_h(tok), json={"body_part": "right_calf", "severity": 5})
    c.post("/symptoms", headers=_h(tok), json={"body_part": "right_big_toe", "severity": 4})
    r = c.get("/symptoms", params={"body_part": "right_big_toe"}, headers=_h(tok))
    assert r.status_code == 200
    arr = r.json()
    assert len(arr) == 2
    assert {s["severity"] for s in arr} == {3, 4}


def test_symptom_linked_to_session(auth_client, seeded_globals):
    c, tok, _ = auth_client
    _, sid = _start(c, tok, seeded_globals["bridge"])
    r = c.post("/symptoms", headers=_h(tok),
               json={"body_part": "right_calf", "severity": 6, "session_id": sid})
    assert r.status_code == 200
    assert r.json()["session_id"] == sid


def test_symptom_with_bogus_session_404s(auth_client):
    c, tok, _ = auth_client
    r = c.post("/symptoms", headers=_h(tok),
               json={"body_part": "x", "severity": 1, "session_id": 99999})
    assert r.status_code == 404


def test_symptom_scoped_to_user(client):
    t1 = client.post("/auth/register", json={"email": "u1@x.com", "password": "pw1234567"}).json()["access_token"]
    client.post("/symptoms", headers=_h(t1), json={"body_part": "x", "severity": 3})
    t2 = client.post("/auth/register", json={"email": "u2@x.com", "password": "pw1234567"}).json()["access_token"]
    r = client.get("/symptoms", headers=_h(t2)).json()
    assert r == []
