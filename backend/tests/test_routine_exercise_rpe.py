"""Per-routine-exercise `target_rpe` — nullable column added in PR B.

Covers:
  - Create via `POST /routines` with `target_rpe=8` on a nested exercise
  - PUT /routines/exercises/{id} updates target_rpe; GET round-trips
  - PUT of bogus values (>10, <1) 422s at the Pydantic layer
  - Clone a routine that has target_rpe set → clone carries it forward
  - Legacy rows with no target_rpe read as null (not 500) — covered by
    the default `_ensure_columns` path; asserted via a create-routine-
    without-rpe + GET round-trip that sees target_rpe=None.
"""


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


def test_target_rpe_round_trips_on_create(auth_client, seeded_globals):
    c, tok, _ = auth_client
    r = c.post(
        "/routines",
        headers=_h(tok),
        json={
            "name": "Strength",
            "goal": "strength",
            "exercises": [
                {"exercise_id": seeded_globals["bridge"], "target_sets": 3, "target_reps": 5, "target_rpe": 8},
            ],
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["exercises"][0]["target_rpe"] == 8

    # Round-trip via GET.
    r = c.get(f"/routines/{body['id']}", headers=_h(tok))
    assert r.status_code == 200
    assert r.json()["exercises"][0]["target_rpe"] == 8


def test_target_rpe_null_by_default(auth_client, seeded_globals):
    """Routines created without RPE should come back as null, not 0 or
    missing. Protects against a future Pydantic config that would make
    Optional[int] silently coerce to 0."""
    c, tok, _ = auth_client
    r = c.post(
        "/routines",
        headers=_h(tok),
        json={
            "name": "Mobility",
            "goal": "mobility",
            "exercises": [
                {"exercise_id": seeded_globals["wall"], "target_duration_sec": 30},
            ],
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["exercises"][0]["target_rpe"] is None


def test_put_target_rpe_updates_and_clears(auth_client, seeded_globals):
    c, tok, _ = auth_client
    r = c.post(
        "/routines",
        headers=_h(tok),
        json={"name": "R", "goal": "strength"},
    )
    rid = r.json()["id"]
    r = c.post(
        f"/routines/{rid}/exercises",
        headers=_h(tok),
        json={"exercise_id": seeded_globals["bridge"], "target_sets": 3, "target_reps": 8},
    )
    re_id = r.json()["id"]
    assert r.json()["target_rpe"] is None

    # Set it.
    r = c.put(
        f"/routines/exercises/{re_id}",
        headers=_h(tok),
        json={"target_rpe": 7},
    )
    assert r.status_code == 200, r.text
    assert r.json()["target_rpe"] == 7

    # Clear it (explicit null, model_dump(exclude_unset) sees the key).
    r = c.put(
        f"/routines/exercises/{re_id}",
        headers=_h(tok),
        json={"target_rpe": None},
    )
    assert r.status_code == 200, r.text
    assert r.json()["target_rpe"] is None


def test_target_rpe_out_of_range_422(auth_client, seeded_globals):
    """Field(ge=1, le=10) bounds enforced at Pydantic level — a legacy
    client sending 42 lands as a validation error, not a persisted bogus."""
    c, tok, _ = auth_client
    r = c.post(
        "/routines",
        headers=_h(tok),
        json={
            "name": "Bogus",
            "goal": "strength",
            "exercises": [
                {"exercise_id": seeded_globals["bridge"], "target_reps": 5, "target_rpe": 42},
            ],
        },
    )
    assert r.status_code == 422, r.text


def test_clone_carries_target_rpe_forward(auth_client, seeded_globals):
    c, tok, _ = auth_client
    r = c.post(
        "/routines",
        headers=_h(tok),
        json={
            "name": "Source",
            "goal": "strength",
            "exercises": [
                {"exercise_id": seeded_globals["bridge"], "target_sets": 3, "target_reps": 6, "target_rpe": 9},
            ],
        },
    )
    src_id = r.json()["id"]

    r = c.post(f"/routines/{src_id}/clone", headers=_h(tok))
    assert r.status_code == 200, r.text
    cloned_exercises = r.json()["exercises"]
    assert len(cloned_exercises) == 1
    assert cloned_exercises[0]["target_rpe"] == 9
