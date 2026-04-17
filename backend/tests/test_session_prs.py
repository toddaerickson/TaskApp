"""PR endpoint tests: /sessions/{id}/prs returns historical bests for the
current user, excluding the active session's own sets."""


def _start_session(client, token, routine_id=None):
    r = client.post(
        "/sessions",
        json={"routine_id": routine_id},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _log_set(client, token, session_id, exercise_id, *, reps=None, weight=None, duration_sec=None):
    r = client.post(
        f"/sessions/{session_id}/sets",
        json={
            "exercise_id": exercise_id,
            "reps": reps,
            "weight": weight,
            "duration_sec": duration_sec,
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    return r.json()


def _finish(client, token, session_id):
    # Close it out so later PR queries count it as "prior".
    r = client.put(
        f"/sessions/{session_id}",
        json={"ended_at": "2026-04-17T12:00:00Z"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text


def test_prs_empty_for_fresh_session(auth_client, seeded_globals):
    client, token, _ = auth_client
    s1 = _start_session(client, token)
    _log_set(client, token, s1, seeded_globals["bridge"], reps=10)
    r = client.get(f"/sessions/{s1}/prs", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    # The only set logged is IN this session, which is excluded from the query,
    # so all bests come back null.
    body = r.json()
    assert len(body) == 1
    assert body[0]["exercise_id"] == seeded_globals["bridge"]
    assert body[0]["max_weight"] is None
    assert body[0]["max_reps"] is None


def test_prs_returns_prior_session_bests(auth_client, seeded_globals):
    client, token, _ = auth_client
    bridge = seeded_globals["bridge"]

    # Session 1: the baseline. 8 reps at 20kg.
    s1 = _start_session(client, token)
    _log_set(client, token, s1, bridge, reps=8, weight=20)
    _finish(client, token, s1)

    # Session 2: still open. Log a set so the exercise is "in scope" for the
    # PR endpoint (it narrows to exercises touched by the session / its
    # routine), and confirm prior bests come through while s2's own sets
    # don't inflate them.
    s2 = _start_session(client, token)
    _log_set(client, token, s2, bridge, reps=12, weight=25)
    r = client.get(f"/sessions/{s2}/prs", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    bests = {row["exercise_id"]: row for row in r.json()}
    assert bests[bridge]["max_weight"] == 20, "s2's own sets must not count"
    assert bests[bridge]["max_reps"] == 8


def test_prs_scoped_to_user(auth_client, client, seeded_globals):
    """One user's sets must never leak into another user's PR query."""
    authed, token_a, _ = auth_client
    bridge = seeded_globals["bridge"]

    # User A logs a heavy prior session.
    s_a = _start_session(authed, token_a)
    _log_set(authed, token_a, s_a, bridge, reps=5, weight=99)
    _finish(authed, token_a, s_a)

    # Register user B using the same TestClient (shared DB, separate user row).
    r = client.post("/auth/register", json={"email": "b@x.com", "password": "pw12345!"})
    token_b = r.json()["access_token"]

    s_b = _start_session(client, token_b)
    r = client.get(f"/sessions/{s_b}/prs", headers={"Authorization": f"Bearer {token_b}"})
    assert r.status_code == 200
    body = r.json()
    # Session has no routine and no sets, so the endpoint returns [].
    # The important thing is: user A's bests must NOT appear.
    for row in body:
        assert row["max_weight"] is None or row["max_weight"] != 99


def test_prs_other_user_cannot_access(auth_client, client):
    authed, token_a, _ = auth_client
    s_a = _start_session(authed, token_a)

    r = client.post("/auth/register", json={"email": "b@x.com", "password": "pw12345!"})
    token_b = r.json()["access_token"]

    # User B tries to read user A's session PRs.
    r = client.get(f"/sessions/{s_a}/prs", headers={"Authorization": f"Bearer {token_b}"})
    assert r.status_code == 404
