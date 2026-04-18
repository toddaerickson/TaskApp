"""Optimistic-concurrency conflict detection on routine edits.

`RoutineUpdate` and `RoutineExerciseUpdate` accept an optional
`expected_updated_at`. If the row has moved past it, the server returns
409 with the current row embedded under `detail.current` so the client
can show "this changed under you" and reconcile.
"""


def _h(token):
    return {"Authorization": f"Bearer {token}"}


def _seed_routine(client, token) -> int:
    r = client.post(
        "/routines",
        json={"name": "r1", "goal": "mobility"},
        headers=_h(token),
    )
    assert r.status_code == 200
    return r.json()["id"]


def test_update_without_expected_is_allowed(auth_client):
    """Legacy callers that don't send expected_updated_at keep working
    (last-write-wins). Conflict detection is opt-in."""
    client, token, _ = auth_client
    rid = _seed_routine(client, token)
    r = client.put(
        f"/routines/{rid}",
        json={"name": "r1-renamed"},
        headers=_h(token),
    )
    assert r.status_code == 200
    assert r.json()["name"] == "r1-renamed"


def test_update_with_fresh_expected_succeeds(auth_client):
    client, token, _ = auth_client
    rid = _seed_routine(client, token)
    got = client.get(f"/routines/{rid}", headers=_h(token)).json()
    # Pass the value we just read — no one raced us.
    r = client.put(
        f"/routines/{rid}",
        json={"name": "r1-renamed", "expected_updated_at": got["updated_at"]},
        headers=_h(token),
    )
    assert r.status_code == 200
    assert r.json()["name"] == "r1-renamed"


def test_update_with_stale_expected_returns_409(auth_client):
    import time
    client, token, _ = auth_client
    rid = _seed_routine(client, token)
    got = client.get(f"/routines/{rid}", headers=_h(token)).json()
    # Simulate another tab saving first. Sleep so the TEXT-stored
    # timestamp actually moves (1s granularity).
    time.sleep(1.2)
    client.put(f"/routines/{rid}", json={"name": "other-tab-wins"}, headers=_h(token))
    # Now our stale PUT should 409.
    r = client.put(
        f"/routines/{rid}",
        json={"name": "we-lose", "expected_updated_at": got["updated_at"]},
        headers=_h(token),
    )
    assert r.status_code == 409
    body = r.json()
    # Structured error shape (code + detail + current row).
    assert body["code"] == "conflict"
    assert body["current"]["name"] == "other-tab-wins"


def test_routine_exercise_update_conflict(auth_client, seeded_globals):
    import time
    client, token, _ = auth_client
    rid = client.post(
        "/routines",
        json={
            "name": "r1", "goal": "mobility",
            "exercises": [{"exercise_id": seeded_globals["wall"], "target_sets": 3}],
        },
        headers=_h(token),
    ).json()["id"]
    routine = client.get(f"/routines/{rid}", headers=_h(token)).json()
    re = routine["exercises"][0]
    re_id = re["id"]
    got_updated = re["updated_at"]

    time.sleep(1.2)
    client.put(
        f"/routines/exercises/{re_id}",
        json={"target_sets": 5},
        headers=_h(token),
    )
    # Stale PUT from an older snapshot → 409.
    r = client.put(
        f"/routines/exercises/{re_id}",
        json={"target_reps": 10, "expected_updated_at": got_updated},
        headers=_h(token),
    )
    assert r.status_code == 409
    assert r.json()["code"] == "conflict"
