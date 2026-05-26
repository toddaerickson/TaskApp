"""Optimistic-concurrency conflict detection on session edits (PR-Y3).

`SessionUpdate` accepts an optional `expected_updated_at`. If the row
has moved past it, the server returns 409 with the current row
embedded under `detail.current` — same shape as the routine + task
conflict responses, via the consolidated `app.concurrency.raise_conflict`.

Closes silent-killer finding S5: before PR-Y3, the two-device
"End session" + "Add notes" race silently last-write-wins.
"""


def _h(token):
    return {"Authorization": f"Bearer {token}"}


def _start_session(client, token, ex_id) -> int:
    routine = client.post(
        "/routines",
        json={"name": "r1", "exercises": [{"exercise_id": ex_id, "target_sets": 3}]},
        headers=_h(token),
    ).json()
    s = client.post("/sessions", json={"routine_id": routine["id"]}, headers=_h(token)).json()
    return s["id"]


def test_session_update_without_expected_is_allowed(auth_client, seeded_globals):
    """Legacy callers stay last-write-wins. Opt-in like routine/task."""
    client, token, _ = auth_client
    sid = _start_session(client, token, seeded_globals["bridge"])
    r = client.put(f"/sessions/{sid}", json={"rpe": 7}, headers=_h(token))
    assert r.status_code == 200
    assert r.json()["rpe"] == 7


def test_session_update_with_stale_expected_returns_409(auth_client, seeded_globals):
    """Two-device race: laptop reads at T0, phone PUTs at T1 bumping
    updated_at, laptop's PUT at T2 with the stale snapshot → 409 with
    the current row embedded."""
    import time
    client, token, _ = auth_client
    sid = _start_session(client, token, seeded_globals["bridge"])
    # First PUT to populate updated_at (sessions are created with a
    # backfilled updated_at = started_at via the migration / _ensure_columns,
    # but on fresh SQLite a START doesn't write updated_at).
    client.put(f"/sessions/{sid}", json={"rpe": 6}, headers=_h(token))
    got = client.get(f"/sessions/{sid}", headers=_h(token)).json()
    assert got["updated_at"] is not None, "updated_at should be set after first PUT"

    time.sleep(1.2)  # SQLite TEXT timestamps are 1s granular.
    client.put(f"/sessions/{sid}", json={"notes": "phone wrote first"}, headers=_h(token))

    r = client.put(
        f"/sessions/{sid}",
        json={"notes": "laptop loses", "expected_updated_at": got["updated_at"]},
        headers=_h(token),
    )
    assert r.status_code == 409
    body = r.json()
    assert body["code"] == "conflict"
    assert "Session changed" in body["detail"]
    assert body["current"]["notes"] == "phone wrote first"


def test_session_update_with_fresh_expected_succeeds(auth_client, seeded_globals):
    client, token, _ = auth_client
    sid = _start_session(client, token, seeded_globals["bridge"])
    client.put(f"/sessions/{sid}", json={"rpe": 5}, headers=_h(token))
    got = client.get(f"/sessions/{sid}", headers=_h(token)).json()
    r = client.put(
        f"/sessions/{sid}",
        json={"notes": "no race", "expected_updated_at": got["updated_at"]},
        headers=_h(token),
    )
    assert r.status_code == 200
    assert r.json()["notes"] == "no race"
