"""Tests for the mobile Workout-CRUD completeness PR:

- PATCH /symptoms/{id} + DELETE /symptoms/{id} (new)
- DELETE /exercises/{id} 409-on-referenced guard (new)

Symptom-log edit / delete scopes strictly to the owning user; cross-user
requests return 404. Exercise delete keeps the existing 403 for globals
and adds a 409 when any routine references the exercise.
"""


def _h(tok: str) -> dict:
    return {"Authorization": f"Bearer {tok}"}


# --- Symptom logs -----------------------------------------------------


def test_patch_symptom_updates_allowlisted_fields(client):
    tok = client.post("/auth/register", json={"email": "u@x.com", "password": "pw1234567"}).json()["access_token"]
    sid = client.post(
        "/symptoms", headers=_h(tok),
        json={"body_part": "right_calf", "severity": 3, "notes": "tight"},
    ).json()["id"]

    r = client.patch(
        f"/symptoms/{sid}", headers=_h(tok),
        json={"severity": 5, "notes": "worse after walk"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["severity"] == 5
    assert body["notes"] == "worse after walk"
    assert body["body_part"] == "right_calf"  # unchanged


def test_patch_symptom_rejects_out_of_range_severity(client):
    tok = client.post("/auth/register", json={"email": "u@x.com", "password": "pw1234567"}).json()["access_token"]
    sid = client.post(
        "/symptoms", headers=_h(tok),
        json={"body_part": "right_calf", "severity": 3},
    ).json()["id"]
    r = client.patch(f"/symptoms/{sid}", headers=_h(tok), json={"severity": 99})
    assert r.status_code == 422


def test_patch_symptom_empty_body_returns_400(client):
    tok = client.post("/auth/register", json={"email": "u@x.com", "password": "pw1234567"}).json()["access_token"]
    sid = client.post(
        "/symptoms", headers=_h(tok),
        json={"body_part": "right_calf", "severity": 3},
    ).json()["id"]
    r = client.patch(f"/symptoms/{sid}", headers=_h(tok), json={})
    assert r.status_code == 400


def test_delete_symptom_happy_path(client):
    tok = client.post("/auth/register", json={"email": "u@x.com", "password": "pw1234567"}).json()["access_token"]
    sid = client.post(
        "/symptoms", headers=_h(tok),
        json={"body_part": "right_calf", "severity": 3},
    ).json()["id"]
    r = client.delete(f"/symptoms/{sid}", headers=_h(tok))
    assert r.status_code == 200
    assert client.get("/symptoms", headers=_h(tok)).json() == []


def test_symptom_patch_delete_are_user_scoped(client):
    t1 = client.post("/auth/register", json={"email": "u1@x.com", "password": "pw1234567"}).json()["access_token"]
    t2 = client.post("/auth/register", json={"email": "u2@x.com", "password": "pw1234567"}).json()["access_token"]
    sid = client.post(
        "/symptoms", headers=_h(t1),
        json={"body_part": "x", "severity": 3},
    ).json()["id"]

    # u2 can neither patch nor delete u1's symptom log.
    r1 = client.patch(f"/symptoms/{sid}", headers=_h(t2), json={"severity": 5})
    assert r1.status_code == 404
    r2 = client.delete(f"/symptoms/{sid}", headers=_h(t2))
    assert r2.status_code == 404


# --- Exercise delete 409-on-referenced guard -------------------------


def test_delete_user_exercise_unreferenced_is_200(client):
    tok = client.post("/auth/register", json={"email": "u@x.com", "password": "pw1234567"}).json()["access_token"]
    ex = client.post(
        "/exercises", headers=_h(tok),
        json={"name": "Lunge", "measurement": "reps", "primary_muscle": "quad"},
    ).json()
    r = client.delete(f"/exercises/{ex['id']}", headers=_h(tok))
    assert r.status_code == 200


def test_delete_user_exercise_returns_409_when_referenced(client):
    tok = client.post("/auth/register", json={"email": "u@x.com", "password": "pw1234567"}).json()["access_token"]
    ex = client.post(
        "/exercises", headers=_h(tok),
        json={"name": "Lunge", "measurement": "reps", "primary_muscle": "quad"},
    ).json()
    # Routine referencing the exercise
    client.post(
        "/routines", headers=_h(tok),
        json={"name": "R", "exercises": [{"exercise_id": ex["id"], "target_sets": 3, "target_reps": 10}]},
    )
    r = client.delete(f"/exercises/{ex['id']}", headers=_h(tok))
    assert r.status_code == 409
    assert "1 routine" in r.json()["detail"]

    # After removing from the routine, delete succeeds.
    routines = client.get("/routines", headers=_h(tok)).json()
    routine = routines["items"] if isinstance(routines, dict) and "items" in routines else routines
    routine_id = routine[0]["id"]
    client.delete(f"/routines/{routine_id}", headers=_h(tok))

    r2 = client.delete(f"/exercises/{ex['id']}", headers=_h(tok))
    assert r2.status_code == 200
