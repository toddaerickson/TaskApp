"""End-to-end lockdown for the tracks_symptoms / pain-score feature.

Walks the entire flow the user sees:
  1. Create rehab routine with tracks_symptoms=true
  2. Start a session from it — session inherits the flag
  3. Log a set with pain_score — server persists
  4. GET suggestions — returns silbernagel policy + pain_last

Also asserts the inverse: strength sessions (tracks_symptoms=false)
silently drop pain_score on log so the progression doesn't accidentally
see pain values from unrelated sets.

Feature-level test — it's the anchor that prevents the recurring
regression on this code path. Route-level tests in other files
cover individual boundaries; this one locks the whole chain.
"""


def _h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _register(client) -> str:
    r = client.post("/auth/register", json={"email": "u@x.com", "password": "pw1234567"})
    return r.json()["access_token"]


def test_rehab_end_to_end_yields_silbernagel_suggestion(client, seeded_globals):
    tok = _register(client)

    # 1. Create rehab routine
    r = client.post(
        "/routines",
        json={
            "name": "Rehab",
            "goal": "rehab",
            "tracks_symptoms": True,
            "exercises": [{
                "exercise_id": seeded_globals["wall"],
                "target_sets": 3,
                "target_duration_sec": 30,
            }],
        },
        headers=_h(tok),
    )
    assert r.status_code == 200, r.text
    routine = r.json()
    assert routine["tracks_symptoms"] is True

    # 2. Start a session. tracks_symptoms should snapshot onto the session.
    r = client.post("/sessions", json={"routine_id": routine["id"]}, headers=_h(tok))
    assert r.status_code == 200
    session = r.json()
    assert session["tracks_symptoms"] is True, (
        "Session did NOT inherit tracks_symptoms from the routine — "
        "this is the regression we keep seeing."
    )

    # 3. Log a set with pain_score. Server should persist because the
    #    parent session has tracks_symptoms=true.
    ex_id = seeded_globals["wall"]
    r = client.post(
        f"/sessions/{session['id']}/sets",
        json={"exercise_id": ex_id, "duration_sec": 30, "pain_score": 5, "completed": True},
        headers=_h(tok),
    )
    assert r.status_code == 200
    set_row = r.json()
    assert set_row["pain_score"] == 5

    # 4. Suggestions should flip to the silbernagel policy with the pain
    #    value reflected in pain_last.
    r = client.get(f"/routines/{routine['id']}/suggestions", headers=_h(tok))
    assert r.status_code == 200
    suggestions = r.json()
    assert len(suggestions) == 1
    s = suggestions[0]
    assert s["policy"] == "silbernagel", (
        f"Expected silbernagel policy; got {s['policy']!r}. "
        "Pain-monitored progression is not firing."
    )
    assert s["pain_last"] == 5


def test_strength_session_drops_pain_score_silently(client, seeded_globals):
    """Inverse guard: a strength session (tracks_symptoms=false) should
    NOT persist pain_score even if a misbehaving client sends one. That
    keeps pain values out of the progression calc for non-rehab routines."""
    tok = _register(client)

    r = client.post(
        "/routines",
        json={
            "name": "Strength",
            "goal": "strength",
            "tracks_symptoms": False,
            "exercises": [{
                "exercise_id": seeded_globals["bridge"],
                "target_sets": 3,
                "target_reps": 10,
            }],
        },
        headers=_h(tok),
    )
    routine = r.json()

    session = client.post(
        "/sessions", json={"routine_id": routine["id"]}, headers=_h(tok),
    ).json()
    assert session["tracks_symptoms"] is False

    r = client.post(
        f"/sessions/{session['id']}/sets",
        json={
            "exercise_id": seeded_globals["bridge"],
            "reps": 10,
            "pain_score": 7,  # client misbehaves and sends this
            "completed": True,
        },
        headers=_h(tok),
    )
    assert r.status_code == 200
    assert r.json()["pain_score"] is None, (
        "pain_score leaked through on a strength session — "
        "server should have dropped it."
    )

    r = client.get(f"/routines/{routine['id']}/suggestions", headers=_h(tok))
    s = r.json()[0]
    assert s["policy"] != "silbernagel", (
        "Strength session suggestion fell through to silbernagel policy; "
        "should have stayed on the default RPE-based path."
    )
