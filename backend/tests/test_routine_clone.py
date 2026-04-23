"""POST /routines/{id}/clone — deep-copy a routine into a fresh template.

Verifies:
  - the clone is a new row owned by the same user
  - name gets the "(copy)" suffix
  - exercises copy over
  - session history is NOT copied (clone is a template, not a session log)
  - cross-user isolation (can't clone someone else's routine)
"""


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


def _minimal_routine(c, tok, tracks_symptoms=False):
    r = c.post(
        "/routines",
        headers=_h(tok),
        json={"name": "Original", "goal": "rehab", "tracks_symptoms": tracks_symptoms},
    )
    assert r.status_code == 200, r.text
    return r.json()


def test_clone_minimal_flat_routine(auth_client, seeded_globals):
    c, tok, _ = auth_client
    src = _minimal_routine(c, tok)

    # Add one exercise so we also verify the routine_exercises copy.
    exlist = c.get("/exercises", headers=_h(tok)).json()
    ex_id = exlist[0]["id"]
    r = c.post(
        f"/routines/{src['id']}/exercises",
        headers=_h(tok),
        json={"exercise_id": ex_id, "target_sets": 2, "target_reps": 8},
    )
    assert r.status_code == 200, r.text

    # Clone.
    r = c.post(f"/routines/{src['id']}/clone", headers=_h(tok))
    assert r.status_code == 200, r.text
    clone = r.json()

    # Fresh id, "(copy)" suffix, same goal + tracks_symptoms snapshot.
    assert clone["id"] != src["id"]
    assert clone["name"] == "Original (copy)"
    assert clone["goal"] == src["goal"]
    assert clone["tracks_symptoms"] == src["tracks_symptoms"]

    # Exercise carried over with target_sets/reps preserved.
    assert len(clone["exercises"]) == 1
    assert clone["exercises"][0]["exercise"]["id"] == ex_id
    assert clone["exercises"][0]["target_sets"] == 2
    assert clone["exercises"][0]["target_reps"] == 8



def test_clone_does_not_copy_session_history(auth_client, seeded_globals):
    c, tok, _ = auth_client
    src = _minimal_routine(c, tok)

    # Start a session against the source routine. We don't care whether
    # it's ended — the test only asserts that the clone's routine_id has
    # no rows in workout_sessions.
    r = c.post("/sessions", headers=_h(tok), json={"routine_id": src["id"]})
    assert r.status_code == 200, r.text
    session_id = r.json()["id"]

    r = c.post(f"/routines/{src['id']}/clone", headers=_h(tok))
    assert r.status_code == 200, r.text
    clone_id = r.json()["id"]

    # listSessions filtered to the clone's routine_id must be empty.
    # The source has one session; this verifies history stayed with
    # the source.
    sessions = c.get(f"/sessions?routine_id={clone_id}", headers=_h(tok)).json()
    assert sessions == [] or all(s["routine_id"] != clone_id for s in sessions)

    sessions_src = c.get(f"/sessions?routine_id={src['id']}", headers=_h(tok)).json()
    assert any(s["id"] == session_id for s in sessions_src)


def test_clone_cross_user_isolation(auth_client):
    """A user cannot clone a routine they don't own. 404 (not 403) so we
    don't leak the fact that the id exists."""
    c, tok_a, _ = auth_client
    src = _minimal_routine(c, tok_a)

    # Register a second user on the same client.
    r = c.post("/auth/register", json={"email": "b@example.com", "password": "pw12345!"})
    assert r.status_code == 200, r.text
    tok_b = r.json()["access_token"]

    r = c.post(f"/routines/{src['id']}/clone", headers=_h(tok_b))
    assert r.status_code == 404
