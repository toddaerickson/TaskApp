"""Tests for exercise soft-delete: archived_at column, DELETE
semantics (UPDATE not DELETE), include_archived filter, restore
endpoint. Replaces the earlier 409-on-referenced guard which is
gone — referenced exercises can be archived freely now."""


def _h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_delete_archives_instead_of_removing(client):
    tok = client.post("/auth/register", json={"email": "u@x.com", "password": "pw1234567"}).json()["access_token"]
    ex = client.post(
        "/exercises", headers=_h(tok),
        json={"name": "Lunge", "measurement": "reps", "primary_muscle": "quad"},
    ).json()
    r = client.delete(f"/exercises/{ex['id']}", headers=_h(tok))
    assert r.status_code == 200

    # Row no longer appears in the default list.
    listing = client.get("/exercises", headers=_h(tok)).json()
    assert all(e["id"] != ex["id"] for e in listing)

    # But it's still there when include_archived=true is passed.
    listing_all = client.get("/exercises?include_archived=true", headers=_h(tok)).json()
    found = next((e for e in listing_all if e["id"] == ex["id"]), None)
    assert found is not None
    assert found["archived_at"] is not None


def test_delete_referenced_exercise_succeeds(client, seeded_globals):
    # Soft-delete means the 409-on-referenced guard is gone — routines
    # that point at the now-archived exercise still resolve because the
    # row stays in the table.
    tok = client.post("/auth/register", json={"email": "u@x.com", "password": "pw1234567"}).json()["access_token"]
    ex = client.post(
        "/exercises", headers=_h(tok),
        json={"name": "Lunge", "measurement": "reps"},
    ).json()
    # Put it in a routine.
    r = client.post(
        "/routines", headers=_h(tok),
        json={"name": "Test", "exercises": [{"exercise_id": ex["id"], "target_sets": 3}]},
    )
    assert r.status_code == 200
    routine = r.json()

    # Soft-delete the exercise — no 409.
    d = client.delete(f"/exercises/{ex['id']}", headers=_h(tok))
    assert d.status_code == 200

    # Routine still has its exercise row (archived but present).
    got = client.get(f"/routines/{routine['id']}", headers=_h(tok)).json()
    assert len(got["exercises"]) == 1
    assert got["exercises"][0]["exercise_id"] == ex["id"]


def test_restore_clears_archived_at(client):
    tok = client.post("/auth/register", json={"email": "u@x.com", "password": "pw1234567"}).json()["access_token"]
    ex = client.post(
        "/exercises", headers=_h(tok),
        json={"name": "Lunge", "measurement": "reps"},
    ).json()
    client.delete(f"/exercises/{ex['id']}", headers=_h(tok))

    r = client.post(f"/exercises/{ex['id']}/restore", headers=_h(tok))
    assert r.status_code == 200
    assert r.json()["archived_at"] is None

    # Default listing now includes it again.
    listing = client.get("/exercises", headers=_h(tok)).json()
    assert any(e["id"] == ex["id"] for e in listing)


def test_restore_is_idempotent(client):
    # Restoring an already-active row should not explode.
    tok = client.post("/auth/register", json={"email": "u@x.com", "password": "pw1234567"}).json()["access_token"]
    ex = client.post(
        "/exercises", headers=_h(tok),
        json={"name": "Lunge", "measurement": "reps"},
    ).json()
    r = client.post(f"/exercises/{ex['id']}/restore", headers=_h(tok))
    assert r.status_code == 200
    assert r.json()["archived_at"] is None


def test_archived_global_still_restorable(client, seeded_globals):
    tok = client.post("/auth/register", json={"email": "u@x.com", "password": "pw1234567"}).json()["access_token"]
    gid = seeded_globals["wall"]
    client.delete(f"/exercises/{gid}", headers=_h(tok))
    r = client.post(f"/exercises/{gid}/restore", headers=_h(tok))
    assert r.status_code == 200
    assert r.json()["archived_at"] is None


def test_cross_user_delete_and_restore_blocked(client):
    t1 = client.post("/auth/register", json={"email": "u1@x.com", "password": "pw1234567"}).json()["access_token"]
    t2 = client.post("/auth/register", json={"email": "u2@x.com", "password": "pw1234567"}).json()["access_token"]
    ex = client.post(
        "/exercises", headers=_h(t1),
        json={"name": "Mine", "measurement": "reps"},
    ).json()
    # u2 can't archive u1's row.
    r1 = client.delete(f"/exercises/{ex['id']}", headers=_h(t2))
    assert r1.status_code == 403
    # u2 can't restore u1's row either.
    r2 = client.post(f"/exercises/{ex['id']}/restore", headers=_h(t2))
    assert r2.status_code == 403


# ---------- Permanent (hard) delete ----------
# Soft-delete is the default cleanup path; this is the "I really mean
# it" path gated by a typed-confirmation in the UI. Backstops the
# referenced-exercise case with a 409 + human-readable count instead of
# a raw FK violation.

def test_permanent_delete_unreferenced_succeeds(client):
    tok = client.post("/auth/register", json={"email": "u@x.com", "password": "pw1234567"}).json()["access_token"]
    ex = client.post(
        "/exercises", headers=_h(tok),
        json={"name": "Lunge", "measurement": "reps"},
    ).json()
    r = client.delete(f"/exercises/{ex['id']}/permanent", headers=_h(tok))
    assert r.status_code == 200
    # Even with include_archived=true, the row is gone.
    listing = client.get("/exercises?include_archived=true", headers=_h(tok)).json()
    assert all(e["id"] != ex["id"] for e in listing)
    # GET-by-id is now a 404.
    g = client.get(f"/exercises/{ex['id']}", headers=_h(tok))
    assert g.status_code == 404


def test_permanent_delete_referenced_in_routine_returns_409(client):
    tok = client.post("/auth/register", json={"email": "u@x.com", "password": "pw1234567"}).json()["access_token"]
    ex = client.post(
        "/exercises", headers=_h(tok),
        json={"name": "Lunge", "measurement": "reps"},
    ).json()
    client.post(
        "/routines", headers=_h(tok),
        json={"name": "Test", "exercises": [{"exercise_id": ex["id"], "target_sets": 3}]},
    )
    r = client.delete(f"/exercises/{ex['id']}/permanent", headers=_h(tok))
    assert r.status_code == 409
    detail = r.json()["detail"]
    assert "1 routine" in detail
    assert "Remove" in detail
    # Row still resolvable.
    assert client.get(f"/exercises/{ex['id']}", headers=_h(tok)).status_code == 200


def test_permanent_delete_archived_unreferenced_succeeds(client):
    """An archived row with no live references is the typical
    'permanent remove' case from the UI's archived-row affordance."""
    tok = client.post("/auth/register", json={"email": "u@x.com", "password": "pw1234567"}).json()["access_token"]
    ex = client.post(
        "/exercises", headers=_h(tok),
        json={"name": "Lunge", "measurement": "reps"},
    ).json()
    client.delete(f"/exercises/{ex['id']}", headers=_h(tok))  # soft-delete first
    r = client.delete(f"/exercises/{ex['id']}/permanent", headers=_h(tok))
    assert r.status_code == 200


def test_permanent_delete_cross_user_blocked(client):
    t1 = client.post("/auth/register", json={"email": "u1@x.com", "password": "pw1234567"}).json()["access_token"]
    t2 = client.post("/auth/register", json={"email": "u2@x.com", "password": "pw1234567"}).json()["access_token"]
    ex = client.post(
        "/exercises", headers=_h(t1),
        json={"name": "Mine", "measurement": "reps"},
    ).json()
    r = client.delete(f"/exercises/{ex['id']}/permanent", headers=_h(t2))
    assert r.status_code == 403


def test_permanent_delete_404_on_unknown_id(client):
    tok = client.post("/auth/register", json={"email": "u@x.com", "password": "pw1234567"}).json()["access_token"]
    r = client.delete("/exercises/999999/permanent", headers=_h(tok))
    assert r.status_code == 404


def test_permanent_delete_cascades_images(client):
    """Images are tied to the exercise via ON DELETE CASCADE — they
    should disappear with the parent."""
    from app.database import get_db
    tok = client.post("/auth/register", json={"email": "u@x.com", "password": "pw1234567"}).json()["access_token"]
    ex = client.post(
        "/exercises", headers=_h(tok),
        json={"name": "Lunge", "measurement": "reps"},
    ).json()
    client.post(
        f"/exercises/{ex['id']}/images", headers=_h(tok),
        json={"url": "https://example.com/x.jpg"},
    )
    r = client.delete(f"/exercises/{ex['id']}/permanent", headers=_h(tok))
    assert r.status_code == 200
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) AS c FROM exercise_images WHERE exercise_id = ?", (ex["id"],))
        assert cur.fetchone()["c"] == 0
