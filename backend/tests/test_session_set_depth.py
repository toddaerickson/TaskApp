"""Per-set side + is_warmup fields — round-trip, normalization, and
patch. Proves:

- POST /sessions/{id}/sets accepts 'left' / 'right' on `side` and the
  GET round-trips the value.
- An unknown side string normalizes to NULL (so old clients with bogus
  values can't corrupt downstream aggregations).
- is_warmup defaults False and round-trips as a proper boolean on both
  SQLite and PG.
- PATCH can toggle both fields on an already-logged set.
"""


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


def _seed_session(c, tok, seeded_globals):
    r = c.post(
        "/routines",
        headers=_h(tok),
        json={"name": "R", "goal": "strength"},
    )
    routine_id = r.json()["id"]
    r = c.post(
        f"/routines/{routine_id}/exercises",
        headers=_h(tok),
        json={"exercise_id": seeded_globals["bridge"], "target_sets": 2, "target_reps": 8},
    )
    assert r.status_code == 200, r.text
    r = c.post("/sessions", headers=_h(tok), json={"routine_id": routine_id})
    return r.json()["id"]


def test_log_set_roundtrips_side_and_is_warmup(auth_client, seeded_globals):
    c, tok, _ = auth_client
    session_id = _seed_session(c, tok, seeded_globals)
    r = c.post(
        f"/sessions/{session_id}/sets",
        headers=_h(tok),
        json={
            "exercise_id": seeded_globals["bridge"],
            "reps": 8,
            "side": "left",
            "is_warmup": True,
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["side"] == "left"
    assert body["is_warmup"] is True

    # Round-trip via the session hydration path.
    r = c.get(f"/sessions/{session_id}", headers=_h(tok))
    assert r.status_code == 200
    sets = r.json()["sets"]
    assert len(sets) == 1
    assert sets[0]["side"] == "left"
    assert sets[0]["is_warmup"] is True


def test_unknown_side_normalizes_to_null(auth_client, seeded_globals):
    """An old client (or bogus API caller) that sends `side: "middle"`
    should land with NULL, not corrupt a downstream aggregation. Same
    guard as the tracks_symptoms=false drop of pain_score in PR #77."""
    c, tok, _ = auth_client
    session_id = _seed_session(c, tok, seeded_globals)
    r = c.post(
        f"/sessions/{session_id}/sets",
        headers=_h(tok),
        json={
            "exercise_id": seeded_globals["bridge"],
            "reps": 8,
            "side": "middle",
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["side"] is None


def test_is_warmup_defaults_false(auth_client, seeded_globals):
    """Omitting is_warmup should never land as True. This is both the
    column default and the route-layer bool coercion; verify both."""
    c, tok, _ = auth_client
    session_id = _seed_session(c, tok, seeded_globals)
    r = c.post(
        f"/sessions/{session_id}/sets",
        headers=_h(tok),
        json={"exercise_id": seeded_globals["bridge"], "reps": 8},
    )
    assert r.status_code == 200, r.text
    assert r.json()["is_warmup"] is False
    assert r.json()["side"] is None


def test_patch_set_updates_side_and_warmup(auth_client, seeded_globals):
    """PATCH /sessions/sets/{id} should accept side + is_warmup in the
    allow-list so a user can correct a miss-tagged set without
    deleting and re-logging."""
    c, tok, _ = auth_client
    session_id = _seed_session(c, tok, seeded_globals)
    r = c.post(
        f"/sessions/{session_id}/sets",
        headers=_h(tok),
        json={"exercise_id": seeded_globals["bridge"], "reps": 8},
    )
    set_id = r.json()["id"]

    r = c.patch(
        f"/sessions/sets/{set_id}",
        headers=_h(tok),
        json={"side": "right", "is_warmup": True},
    )
    assert r.status_code == 200, r.text
    assert r.json()["side"] == "right"
    assert r.json()["is_warmup"] is True

    # Bogus side on PATCH also drops to NULL.
    r = c.patch(
        f"/sessions/sets/{set_id}",
        headers=_h(tok),
        json={"side": "bogus"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["side"] is None
    # is_warmup untouched by this PATCH (it wasn't sent).
    assert r.json()["is_warmup"] is True
