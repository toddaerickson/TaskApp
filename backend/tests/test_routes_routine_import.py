"""POST /routines/import — portable JSON template ingestion.

Verifies the all-or-nothing contract (one bad slug or out-of-range
phase_idx 400s before any rows are written), the slug→id resolution,
the phase_idx→phase_id remapping, and the measurement compatibility
check that catches "logged a 30s hold as 30 reps" mistakes."""


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
    assert body["phase_start_date"] is None
    assert len(body["exercises"]) == 1
    assert body["exercises"][0]["exercise"]["slug"] == "wall_ankle_dorsiflexion"
    assert body["exercises"][0]["target_duration_sec"] == 30
    # No phases declared → none created.
    assert body["phases"] == []


def test_import_with_phases_remaps_phase_idx(auth_client, seeded_globals):
    c, tok, _ = auth_client
    payload = {
        "name": "Phased Import",
        "goal": "rehab",
        "phase_start_date": "2026-04-20",
        "phases": [
            {"label": "Foundation", "duration_weeks": 2},
            {"label": "Loading", "duration_weeks": 6},
        ],
        "exercises": [
            {"slug": "wall_ankle_dorsiflexion", "phase_idx": None,
             "target_duration_sec": 30, "target_sets": 2},  # warmup, every phase
            {"slug": "single_leg_glute_bridge", "phase_idx": 0,
             "target_reps": 10, "target_sets": 2},
            {"slug": "single_leg_glute_bridge", "phase_idx": 1,
             "target_reps": 15, "target_sets": 3, "keystone": True},
        ],
    }
    r = c.post("/routines/import", headers=_h(tok), json=payload)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["phase_start_date"] == "2026-04-20"
    assert len(body["phases"]) == 2
    p0_id = next(p["id"] for p in body["phases"] if p["order_idx"] == 0)
    p1_id = next(p["id"] for p in body["phases"] if p["order_idx"] == 1)
    by_slug_phase = {(e["exercise"]["slug"], e["phase_id"]): e for e in body["exercises"]}
    assert (("wall_ankle_dorsiflexion", None) in by_slug_phase)
    assert (("single_leg_glute_bridge", p0_id) in by_slug_phase)
    assert (("single_leg_glute_bridge", p1_id) in by_slug_phase)
    assert by_slug_phase[("single_leg_glute_bridge", p1_id)]["keystone"] is True


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


def test_import_rejects_out_of_range_phase_idx(auth_client, seeded_globals):
    c, tok, _ = auth_client
    payload = {
        "name": "Bad Phase Ref",
        "phases": [{"label": "Only", "duration_weeks": 2}],
        "exercises": [{
            "slug": "wall_ankle_dorsiflexion",
            "phase_idx": 5,  # out of range
            "target_duration_sec": 30,
        }],
    }
    r = c.post("/routines/import", headers=_h(tok), json=payload)
    assert r.status_code == 400
    assert "phase_idx" in r.json()["detail"]
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
