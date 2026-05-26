"""End-to-end happy-path test for the workout session flow.

Each existing test_routes_*.py file unit-tests one endpoint in isolation;
this file exercises the full user journey in a single scenario so we catch
integration issues the unit tests don't. Specifically: that data written by
one endpoint is visible to downstream endpoints, that suggestions reflect
the completed session, and that mood/rpe/ended_at stick after PUT.
"""


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


def test_full_session_happy_path(client, seeded_globals):
    """register → create routine → start session → log sets → finish →
    fetch suggestions. Each step asserts something the prior step produced."""

    # --- 1. Register.
    r = client.post(
        "/auth/register",
        json={"email": "flow@x.com", "password": "pw1234567!"},
    )
    assert r.status_code == 200, r.text
    tok = r.json()["access_token"]

    # --- 2. Create a routine with two exercises.
    r = client.post(
        "/routines",
        headers=_h(tok),
        json={
            "name": "E2E Routine",
            "goal": "rehab",
            "exercises": [
                {
                    "exercise_id": seeded_globals["wall"],
                    "target_sets": 3,
                    "target_duration_sec": 30,
                    "keystone": True,
                },
                {
                    "exercise_id": seeded_globals["bridge"],
                    "target_sets": 3,
                    "target_reps": 10,
                },
            ],
        },
    )
    assert r.status_code == 200, r.text
    routine = r.json()
    assert routine["name"] == "E2E Routine"
    assert len(routine["exercises"]) == 2
    # Keep references to the routine-exercise IDs so we can log sets with
    # the right exercise_id, not the raw catalog ID.
    wall_re = next(
        re for re in routine["exercises"]
        if re["exercise_id"] == seeded_globals["wall"]
    )
    bridge_re = next(
        re for re in routine["exercises"]
        if re["exercise_id"] == seeded_globals["bridge"]
    )

    # --- 3. Start a session.
    r = client.post(
        "/sessions",
        headers=_h(tok),
        json={"routine_id": routine["id"]},
    )
    assert r.status_code == 200, r.text
    session = r.json()
    sid = session["id"]
    assert session["ended_at"] is None
    assert session["routine_id"] == routine["id"]

    # --- 4. Log sets. Don't send set_number — the server assigns it atomically.
    for _ in range(3):
        r = client.post(
            f"/sessions/{sid}/sets",
            headers=_h(tok),
            json={"exercise_id": wall_re["exercise_id"], "duration_sec": 30},
        )
        assert r.status_code == 200, r.text
    # Mix exercises so we verify set_number is scoped per-exercise.
    for reps in (10, 9, 8):
        r = client.post(
            f"/sessions/{sid}/sets",
            headers=_h(tok),
            json={"exercise_id": bridge_re["exercise_id"], "reps": reps},
        )
        assert r.status_code == 200, r.text

    # Confirm the server assigned 1..3 for each exercise independently.
    r = client.get(f"/sessions/{sid}", headers=_h(tok))
    assert r.status_code == 200, r.text
    sets = r.json()["sets"]
    wall_sets = [s for s in sets if s["exercise_id"] == wall_re["exercise_id"]]
    bridge_sets = [s for s in sets if s["exercise_id"] == bridge_re["exercise_id"]]
    assert sorted(s["set_number"] for s in wall_sets) == [1, 2, 3]
    assert sorted(s["set_number"] for s in bridge_sets) == [1, 2, 3]

    # --- 5. Finish the session (ended_at, rpe, mood).
    r = client.put(
        f"/sessions/{sid}",
        headers=_h(tok),
        json={
            "ended_at": "2026-04-17T12:00:00Z",
            "rpe": 7,
            "mood": 4,
            "notes": "felt good",
        },
    )
    assert r.status_code == 200, r.text
    finished = r.json()
    assert finished["ended_at"] is not None
    assert finished["rpe"] == 7
    assert finished["mood"] == 4
    assert finished["notes"] == "felt good"

    # --- 6. Suggestions reflect the completed session.
    r = client.get(
        f"/routines/{routine['id']}/suggestions",
        headers=_h(tok),
    )
    assert r.status_code == 200, r.text
    sug = r.json()
    assert len(sug) == 2
    # Each slot gets a suggestion — the concrete number/reason depends on the
    # progression algorithm, but a non-empty reason and a matching routine
    # exercise id prove the pipeline worked end-to-end.
    for s in sug:
        assert s["routine_exercise_id"] in (wall_re["id"], bridge_re["id"])
        assert s["reason"]


def test_cannot_log_set_after_finish(client, seeded_globals):
    """Once ended_at is set, new-set inserts to the session are rejected
    — this protects the suggestion algorithm from stats mutating under
    it. PR-Y9 made this enforcement deterministic (was 200/400/409
    before). PATCH + DELETE on existing sets remain allowed; those are
    backfill paths used by the pain-chip UX."""
    r = client.post(
        "/auth/register",
        json={"email": "f2@x.com", "password": "pw1234567!"},
    ).json()
    tok = r["access_token"]

    r = client.post(
        "/routines",
        headers=_h(tok),
        json={
            "name": "R",
            "exercises": [
                {"exercise_id": seeded_globals["bridge"], "target_sets": 1, "target_reps": 5}
            ],
        },
    ).json()
    bridge_ex_id = r["exercises"][0]["exercise_id"]
    sid = client.post(
        "/sessions", headers=_h(tok), json={"routine_id": r["id"]}
    ).json()["id"]
    # Finish immediately.
    client.put(
        f"/sessions/{sid}",
        headers=_h(tok),
        json={"ended_at": "2026-04-17T12:00:00Z"},
    )

    r = client.post(
        f"/sessions/{sid}/sets",
        headers=_h(tok),
        json={"exercise_id": bridge_ex_id, "reps": 5},
    )
    assert r.status_code == 409, r.text
    body = r.json()
    assert body["code"] == "session_ended"
    assert "finished" in body["detail"].lower()


def test_can_patch_and_delete_sets_after_session_ended(client, seeded_globals):
    """PR-Y9 explicitly scoped the rejection to new-set INSERTs (POST).
    The pain-chip UX backfills via PATCH after the session is finished —
    that path must keep working, as must DELETE (user catches a typo
    in a logged set after wrapping up)."""
    r = client.post(
        "/auth/register",
        json={"email": "f3@x.com", "password": "pw1234567!"},
    ).json()
    tok = r["access_token"]
    routine = client.post(
        "/routines",
        headers=_h(tok),
        json={
            "name": "R",
            "exercises": [{"exercise_id": seeded_globals["bridge"], "target_sets": 1, "target_reps": 5}],
        },
    ).json()
    sid = client.post(
        "/sessions", headers=_h(tok), json={"routine_id": routine["id"]}
    ).json()["id"]
    # Log a set, then finish.
    set_id = client.post(
        f"/sessions/{sid}/sets",
        headers=_h(tok),
        json={"exercise_id": seeded_globals["bridge"], "reps": 5},
    ).json()["id"]
    client.put(
        f"/sessions/{sid}",
        headers=_h(tok),
        json={"ended_at": "2026-04-17T12:00:00Z"},
    )

    # PATCH still works after end.
    r = client.patch(
        f"/sessions/sets/{set_id}",
        headers=_h(tok),
        json={"reps": 6, "notes": "corrected"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["reps"] == 6
    assert r.json()["notes"] == "corrected"

    # DELETE still works after end.
    r = client.delete(f"/sessions/sets/{set_id}", headers=_h(tok))
    assert r.status_code == 200, r.text
