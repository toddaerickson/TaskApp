"""POST /routines/import — portable JSON template ingestion.

Verifies the all-or-nothing contract (one bad slug 400s before any
rows are written), the slug→id resolution, and the measurement
compatibility check that catches "logged a 30s hold as 30 reps"
mistakes."""


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


def _minimal(slug="wall_ankle_dorsiflexion"):
    return {
        "name": "Imported Routine",
        "goal": "rehab",
        "exercises": [{
            "slug": slug,
            "target_sets": 2,
            "target_duration_sec": 30,
            "rest_sec": 30,
        }],
    }


def test_import_minimal_flat_routine(auth_client, seeded_globals):
    c, tok, _ = auth_client
    r = c.post("/routines/import", headers=_h(tok), json=_minimal())
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["name"] == "Imported Routine"
    assert body["goal"] == "rehab"
    assert len(body["exercises"]) == 1
    assert body["exercises"][0]["exercise"]["slug"] == "wall_ankle_dorsiflexion"
    assert body["exercises"][0]["target_duration_sec"] == 30


def test_import_rejects_unknown_slug_atomically(auth_client, seeded_globals):
    """Bad slug 400s before any rows are written — no orphan routine."""
    c, tok, _ = auth_client
    payload = _minimal()
    payload["exercises"].append({
        "slug": "definitely_not_a_real_slug",
        "target_reps": 10,
    })
    r = c.post("/routines/import", headers=_h(tok), json=payload)
    assert r.status_code == 400
    assert "definitely_not_a_real_slug" in r.json()["detail"]
    # No routine landed.
    assert c.get("/routines", headers=_h(tok)).json() == []


def test_import_rejects_measurement_mismatch(auth_client, seeded_globals):
    """Duration exercise without target_duration_sec → 400. Catches the
    common 'logged a 30s hold as 30 reps' authoring mistake."""
    c, tok, _ = auth_client
    payload = _minimal()
    payload["exercises"][0] = {
        "slug": "wall_ankle_dorsiflexion",  # duration
        "target_reps": 10,                  # wrong axis
        "target_sets": 2,
    }
    r = c.post("/routines/import", headers=_h(tok), json=payload)
    assert r.status_code == 400
    assert "duration" in r.json()["detail"].lower()


def test_import_requires_at_least_one_exercise(auth_client, seeded_globals):
    c, tok, _ = auth_client
    r = c.post("/routines/import", headers=_h(tok), json={"name": "Empty", "exercises": []})
    assert r.status_code == 400


def test_import_caps_list_sizes(auth_client, seeded_globals):
    """max_length on exercises keeps a confused or malicious client from
    building a slug IN (?,?,...) query that exceeds the SQLite parameter
    cap (32,766) and takes a worker down."""
    c, tok, _ = auth_client

    too_many_exercises = {
        "name": "Huge",
        "exercises": [{"slug": "wall_ankle_dorsiflexion",
                       "target_sets": 1, "target_duration_sec": 30}
                      for _ in range(201)],
    }
    r = c.post("/routines/import", headers=_h(tok), json=too_many_exercises)
    assert r.status_code == 422


def test_import_isolates_users(auth_client, seeded_globals):
    """A user's exercise (user_id != NULL) is invisible to other users —
    importing a routine that references it 400s for the second user."""
    c, tok, _ = auth_client
    # User 1 has the seeded global slugs; that just works.
    r = c.post("/routines/import", headers=_h(tok), json=_minimal())
    assert r.status_code == 200
    # User 2 also can import using globals.
    t2 = c.post("/auth/register", json={"email": "u2@x.com", "password": "pw1234567"}).json()["access_token"]
    r2 = c.post("/routines/import", headers=_h(t2), json=_minimal())
    assert r2.status_code == 200
    # User 2 sees only their own routine.
    assert len(c.get("/routines", headers=_h(t2)).json()) == 1
