"""Export / import round-trip tests."""


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


def test_export_empty_user_returns_empty_sections(auth_client):
    c, tok, _ = auth_client
    r = c.get("/export/workouts", headers=_h(tok))
    assert r.status_code == 200
    body = r.json()
    assert body["version"] == 1
    assert body["exercises"] == []
    assert body["routines"] == []
    assert body["sessions"] == []
    assert body["symptoms"] == []


def test_roundtrip_global_exercise_routine_session(auth_client, seeded_globals):
    """Build a routine + session on user 1, export, import into user 2 (merge),
    and verify everything landed with correct references."""
    c, tok, _ = auth_client

    r = c.post("/routines", headers=_h(tok), json={
        "name": "AM",
        "exercises": [{"exercise_id": seeded_globals["bridge"], "target_sets": 3, "target_reps": 12}],
    }).json()
    sess = c.post("/sessions", headers=_h(tok), json={"routine_id": r["id"]}).json()
    c.post(f"/sessions/{sess['id']}/sets", headers=_h(tok),
           json={"exercise_id": seeded_globals["bridge"], "reps": 12, "rpe": 7})
    c.put(f"/sessions/{sess['id']}", headers=_h(tok),
          json={"ended_at": "2026-04-10T08:00:00Z", "rpe": 7, "mood": 4})
    c.post("/symptoms", headers=_h(tok),
           json={"body_part": "right_calf", "severity": 3, "session_id": sess["id"]})

    payload = c.get("/export/workouts", headers=_h(tok)).json()
    assert len(payload["routines"]) == 1
    assert payload["routines"][0]["exercises"][0]["exercise_slug"] == "single_leg_glute_bridge"
    assert len(payload["sessions"]) == 1
    assert len(payload["sessions"][0]["sets"]) == 1
    assert len(payload["symptoms"]) == 1
    assert payload["symptoms"][0]["session_index"] == 0

    # Bring the payload back into a second user.
    t2 = c.post("/auth/register", json={"email": "u2@x.com", "password": "pw1234567"}).json()["access_token"]
    imp = c.post("/import/workouts", headers=_h(t2),
                 json={"payload": payload, "mode": "merge"}).json()
    assert imp["routines_added"] == 1
    assert imp["sessions_added"] == 1
    assert imp["symptoms_added"] == 1
    # Exercise slug resolves to the global library on u2 — no user exercise created.
    assert imp["exercises_added"] == 0

    u2_routines = c.get("/routines", headers=_h(t2)).json()
    assert len(u2_routines) == 1
    assert u2_routines[0]["name"] == "AM"
    assert u2_routines[0]["exercises"][0]["exercise"]["slug"] == "single_leg_glute_bridge"


def test_import_user_owned_exercise_roundtrips_by_index(auth_client):
    c, tok, _ = auth_client
    # User 1 creates a private exercise (no slug, user-owned), uses it in a routine.
    ex = c.post("/exercises", headers=_h(tok),
                json={"name": "My Custom", "measurement": "reps"}).json()
    c.post("/routines", headers=_h(tok), json={
        "name": "Custom",
        "exercises": [{"exercise_id": ex["id"], "target_sets": 3, "target_reps": 10}],
    })
    payload = c.get("/export/workouts", headers=_h(tok)).json()
    assert len(payload["exercises"]) == 1
    assert payload["exercises"][0]["name"] == "My Custom"
    assert payload["routines"][0]["exercises"][0]["exercise_index"] == 0
    assert payload["routines"][0]["exercises"][0]["exercise_slug"] is None

    # Import into u2. The custom exercise is created on u2 and linked.
    t2 = c.post("/auth/register", json={"email": "u2@x.com", "password": "pw1234567"}).json()["access_token"]
    imp = c.post("/import/workouts", headers=_h(t2),
                 json={"payload": payload, "mode": "merge"}).json()
    assert imp["exercises_added"] == 1
    assert imp["routines_added"] == 1
    u2_routines = c.get("/routines", headers=_h(t2)).json()
    assert u2_routines[0]["exercises"][0]["exercise"]["name"] == "My Custom"


def test_merge_mode_skips_duplicate_routine_by_name(auth_client, seeded_globals):
    c, tok, _ = auth_client
    c.post("/routines", headers=_h(tok), json={"name": "AM"})
    payload = c.get("/export/workouts", headers=_h(tok)).json()
    # Import to the SAME user — should skip.
    imp = c.post("/import/workouts", headers=_h(tok),
                 json={"payload": payload, "mode": "merge"}).json()
    assert imp["routines_added"] == 0
    assert imp["routines_skipped"] == 1
    assert len(c.get("/routines", headers=_h(tok)).json()) == 1


def test_replace_mode_wipes_existing(auth_client, seeded_globals):
    c, tok, _ = auth_client
    c.post("/routines", headers=_h(tok), json={"name": "Old"})
    c.post("/symptoms", headers=_h(tok), json={"body_part": "a", "severity": 3})

    # Import a payload that has a single different routine → replace mode
    # should wipe "Old" and the symptom.
    payload = {
        "version": 1, "exported_at": "2026-04-14T00:00:00Z",
        "exercises": [], "routines": [{"name": "Fresh", "goal": "general"}],
        "sessions": [], "symptoms": [],
    }
    imp = c.post("/import/workouts", headers=_h(tok),
                 json={"payload": payload, "mode": "replace"}).json()
    assert imp["routines_added"] == 1
    names = [r["name"] for r in c.get("/routines", headers=_h(tok)).json()]
    assert names == ["Fresh"]
    assert c.get("/symptoms", headers=_h(tok)).json() == []


def test_dry_run_makes_no_changes(auth_client, seeded_globals):
    c, tok, _ = auth_client
    payload = {
        "version": 1, "exported_at": "2026-04-14T00:00:00Z",
        "exercises": [], "routines": [{"name": "ShouldNotAppear", "goal": "general"}],
        "sessions": [], "symptoms": [],
    }
    imp = c.post("/import/workouts", headers=_h(tok),
                 json={"payload": payload, "mode": "merge", "dry_run": True}).json()
    assert imp["dry_run"] is True
    assert imp["routines_added"] == 1
    assert c.get("/routines", headers=_h(tok)).json() == []  # nothing written


def test_version_mismatch_400s(auth_client):
    c, tok, _ = auth_client
    payload = {
        "version": 999, "exported_at": "2026-04-14T00:00:00Z",
        "exercises": [], "routines": [], "sessions": [], "symptoms": [],
    }
    r = c.post("/import/workouts", headers=_h(tok),
               json={"payload": payload, "mode": "merge"})
    assert r.status_code == 400


def test_unresolvable_exercise_reference_warns(auth_client):
    c, tok, _ = auth_client
    payload = {
        "version": 1, "exported_at": "2026-04-14T00:00:00Z",
        "exercises": [],
        "routines": [{
            "name": "X", "goal": "general",
            "exercises": [{"exercise_slug": "nope_not_there", "sort_order": 0}],
        }],
        "sessions": [], "symptoms": [],
    }
    imp = c.post("/import/workouts", headers=_h(tok),
                 json={"payload": payload, "mode": "merge"}).json()
    # Routine still added; inner reference dropped with a warning.
    assert imp["routines_added"] == 1
    assert any("nope_not_there" in w for w in imp["warnings"])
    routines = c.get("/routines", headers=_h(tok)).json()
    assert routines[0]["exercises"] == []


def test_unauthenticated_cannot_export_or_import(client):
    r = client.get("/export/workouts")
    assert r.status_code in (401, 403)
    r2 = client.post("/import/workouts", json={"payload": {
        "version": 1, "exported_at": "x", "exercises": [], "routines": [],
        "sessions": [], "symptoms": [],
    }})
    assert r2.status_code in (401, 403)
