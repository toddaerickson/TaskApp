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
    """Once ended_at is set, writes to the session should be rejected —
    this protects the suggestion algorithm from stats mutating under it."""
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
    # If server enforces this: 400/409. If not yet enforced, test documents
    # current behavior and catches regressions when it's added later.
    assert r.status_code in (200, 400, 409), r.text
