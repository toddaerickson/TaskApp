"""Update/delete-path tests: routine PUT, routine_exercise PUT, routine
delete cascade, exercise update scoping."""


def _h(token):
    return {"Authorization": f"Bearer {token}"}


def test_routine_put_updates_name_and_notes(auth_client, seeded_globals):
    c, tok, _ = auth_client
    r = c.post("/routines", headers=_h(tok), json={"name": "Old", "notes": "n1"}).json()
    upd = c.put(f"/routines/{r['id']}", headers=_h(tok),
                json={"name": "New", "notes": "n2"})
    assert upd.status_code == 200
    assert upd.json()["name"] == "New"
    assert upd.json()["notes"] == "n2"


def test_routine_put_partial_preserves_other_fields(auth_client):
    c, tok, _ = auth_client
    r = c.post("/routines", headers=_h(tok), json={"name": "Orig", "notes": "keepme"}).json()
    upd = c.put(f"/routines/{r['id']}", headers=_h(tok), json={"name": "Renamed"}).json()
    assert upd["name"] == "Renamed"
    assert upd["notes"] == "keepme"


def test_routine_delete_cascades_exercises(auth_client, seeded_globals):
    c, tok, _ = auth_client
    r = c.post("/routines", headers=_h(tok), json={
        "name": "T",
        "exercises": [{"exercise_id": seeded_globals["bridge"], "target_sets": 3}],
    }).json()
    d = c.delete(f"/routines/{r['id']}", headers=_h(tok))
    assert d.status_code == 200
    assert c.get(f"/routines/{r['id']}", headers=_h(tok)).status_code == 404


def test_user2_cannot_update_user1_routine(client, seeded_globals):
    t1 = client.post("/auth/register", json={"email": "u1@x.com", "password": "pw1234567"}).json()["access_token"]
    r = client.post("/routines", headers=_h(t1), json={"name": "mine"}).json()
    t2 = client.post("/auth/register", json={"email": "u2@x.com", "password": "pw1234567"}).json()["access_token"]
    r2 = client.put(f"/routines/{r['id']}", headers=_h(t2), json={"name": "hax"})
    assert r2.status_code == 404


# ---------- Routine exercise PUT / add / remove ----------

def test_routine_exercise_put_updates_targets_and_keystone(auth_client, seeded_globals):
    c, tok, _ = auth_client
    r = c.post("/routines", headers=_h(tok), json={
        "name": "T",
        "exercises": [{"exercise_id": seeded_globals["bridge"], "target_sets": 3, "target_reps": 10}],
    }).json()
    re_id = r["exercises"][0]["id"]
    upd = c.put(f"/routines/exercises/{re_id}", headers=_h(tok),
                json={"target_sets": 5, "target_reps": 8, "keystone": True, "notes": "drive hard"})
    assert upd.status_code == 200
    body = upd.json()
    assert body["target_sets"] == 5
    assert body["target_reps"] == 8
    assert body["keystone"] is True
    assert body["notes"] == "drive hard"


def test_add_and_remove_exercise_from_routine(auth_client, seeded_globals):
    c, tok, _ = auth_client
    r = c.post("/routines", headers=_h(tok), json={"name": "T"}).json()
    add = c.post(f"/routines/{r['id']}/exercises", headers=_h(tok),
                 json={"exercise_id": seeded_globals["wall"], "target_sets": 2, "target_duration_sec": 60})
    assert add.status_code == 200
    re_id = add.json()["id"]
    fetched = c.get(f"/routines/{r['id']}", headers=_h(tok)).json()
    assert len(fetched["exercises"]) == 1
    rm = c.delete(f"/routines/exercises/{re_id}", headers=_h(tok))
    assert rm.status_code == 200
    fetched2 = c.get(f"/routines/{r['id']}", headers=_h(tok)).json()
    assert fetched2["exercises"] == []


def test_user2_cannot_update_user1_routine_exercise(client, seeded_globals):
    t1 = client.post("/auth/register", json={"email": "u1@x.com", "password": "pw1234567"}).json()["access_token"]
    r = client.post("/routines", headers=_h(t1), json={
        "name": "T",
        "exercises": [{"exercise_id": seeded_globals["bridge"], "target_sets": 3}],
    }).json()
    re_id = r["exercises"][0]["id"]
    t2 = client.post("/auth/register", json={"email": "u2@x.com", "password": "pw1234567"}).json()["access_token"]
    r2 = client.put(f"/routines/exercises/{re_id}", headers=_h(t2), json={"target_sets": 99})
    assert r2.status_code == 404


# ---------- Exercise update scoping ----------

def test_user_private_exercise_cannot_be_edited_by_other(client):
    t1 = client.post("/auth/register", json={"email": "u1@x.com", "password": "pw1234567"}).json()["access_token"]
    ex = client.post("/exercises", headers=_h(t1),
                     json={"name": "Mine", "slug": "mine", "measurement": "reps"}).json()
    t2 = client.post("/auth/register", json={"email": "u2@x.com", "password": "pw1234567"}).json()["access_token"]
    r = client.put(f"/exercises/{ex['id']}", headers=_h(t2), json={"cue": "hax"})
    assert r.status_code == 403
