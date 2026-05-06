"""Optimistic-concurrency conflict detection on task edits (PR-D0).

`TaskUpdate` accepts an optional `expected_updated_at`. If the row has
moved past it, the server returns 409 with the current row embedded
under the top-level `current` key (the global exception handler in
main.py flattens dict-detail extras to the response root).

Mirrors `test_routine_conflict.py` — same shape, different route.
The drag-to-regroup feature for tasks (PR-D3+) depends on this.
"""


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


def _seed_task(client, token, **overrides) -> dict:
    payload = {"title": "t1", **overrides}
    r = client.post("/tasks", json=payload, headers=_h(token))
    assert r.status_code == 200
    return r.json()


def test_update_without_expected_is_allowed(auth_client):
    """Legacy callers that don't send expected_updated_at keep working
    (last-write-wins). Conflict detection is opt-in."""
    client, token, _ = auth_client
    task = _seed_task(client, token)
    r = client.put(
        f"/tasks/{task['id']}",
        json={"title": "t1-renamed"},
        headers=_h(token),
    )
    assert r.status_code == 200
    assert r.json()["title"] == "t1-renamed"


def test_update_with_fresh_expected_succeeds(auth_client):
    client, token, _ = auth_client
    task = _seed_task(client, token)
    got = client.get(f"/tasks/{task['id']}", headers=_h(token)).json()
    # Pass the value we just read — no one raced us.
    r = client.put(
        f"/tasks/{task['id']}",
        json={"title": "t1-renamed", "expected_updated_at": got["updated_at"]},
        headers=_h(token),
    )
    assert r.status_code == 200
    assert r.json()["title"] == "t1-renamed"


def test_update_with_stale_expected_returns_409(auth_client):
    """Drag-to-regroup canonical case: tab A has snapshot, tab B saves
    first, tab A's stale PUT must 409 with current row embedded so tab
    A can reconcile in one round-trip rather than overwriting B."""
    import time
    client, token, _ = auth_client
    task = _seed_task(client, token)
    got = client.get(f"/tasks/{task['id']}", headers=_h(token)).json()
    # Simulate another tab saving first. Sleep so the TEXT-stored
    # timestamp actually moves (1s granularity matches the routine
    # test — SQLite's datetime('now') truncates to seconds).
    time.sleep(1.2)
    client.put(f"/tasks/{task['id']}", json={"title": "other-tab-wins"}, headers=_h(token))
    # Now our stale PUT should 409.
    r = client.put(
        f"/tasks/{task['id']}",
        json={"title": "we-lose", "expected_updated_at": got["updated_at"]},
        headers=_h(token),
    )
    assert r.status_code == 409
    body = r.json()
    # Structured error shape: code + current row, both at the root
    # via the flatten-extras logic in main.py:_http_exc_handler.
    assert body["code"] == "conflict"
    assert body["current"]["title"] == "other-tab-wins"


def test_drag_regroup_concurrency_pattern(auth_client):
    """End-to-end of the actual drag use case: client snapshots a task,
    drags it to a new folder, but a competing PUT moved it elsewhere
    first. Expected: 409 + current row shows the competing folder."""
    import time
    client, token, _ = auth_client
    f1 = client.post("/folders", json={"name": "F1"}, headers=_h(token)).json()["id"]
    f2 = client.post("/folders", json={"name": "F2"}, headers=_h(token)).json()["id"]
    f3 = client.post("/folders", json={"name": "F3"}, headers=_h(token)).json()["id"]

    task = _seed_task(client, token, folder_id=f1)
    snapshot = client.get(f"/tasks/{task['id']}", headers=_h(token)).json()

    time.sleep(1.2)
    # Tab B's drag wins.
    client.put(f"/tasks/{task['id']}", json={"folder_id": f2}, headers=_h(token))

    # Tab A's drag, with the stale snapshot, would have moved it to f3.
    # Server rejects rather than clobbering tab B's f2.
    r = client.put(
        f"/tasks/{task['id']}",
        json={"folder_id": f3, "expected_updated_at": snapshot["updated_at"]},
        headers=_h(token),
    )
    assert r.status_code == 409
    assert r.json()["current"]["folder_id"] == f2
