"""Tests for the `exercises.evidence_tier` column + Pydantic Literal
validation. The tier surfaces as a UI chip; the schema is intentionally
permissive (NULL = no chip), but the create endpoint enforces the four
canonical values via Pydantic so an old client can't post a typo'd tier
that later renders as a missing-icon chip.

Also asserts that `ExerciseUpdate` does NOT carry the tier field — write
parity is deliberately deferred (no V1 UI writes it).
"""


def _h(token):
    return {"Authorization": f"Bearer {token}"}


def _create_exercise(c, tok, **overrides):
    body = {
        "name": "Test Exercise",
        "category": "mobility",
        "primary_muscle": "test",
        "equipment": "none",
        "difficulty": 1,
        "is_bodyweight": True,
        "measurement": "duration",
        **overrides,
    }
    return c.post("/exercises", headers=_h(tok), json=body)


def test_create_exercise_with_rct_tier(auth_client):
    c, tok, _ = auth_client
    r = _create_exercise(c, tok, evidence_tier="RCT")
    assert r.status_code == 200
    assert r.json()["evidence_tier"] == "RCT"


def test_create_exercise_with_each_tier_round_trips(auth_client):
    c, tok, _ = auth_client
    for tier in ("RCT", "MECHANISM", "PRACTITIONER", "THEORETICAL"):
        r = _create_exercise(c, tok, name=f"Test {tier}", evidence_tier=tier)
        assert r.status_code == 200, r.text
        assert r.json()["evidence_tier"] == tier
        # GET round-trip: hydrator must return the column verbatim.
        ex_id = r.json()["id"]
        got = c.get(f"/exercises/{ex_id}", headers=_h(tok)).json()
        assert got["evidence_tier"] == tier


def test_create_exercise_with_invalid_tier_returns_422(auth_client):
    c, tok, _ = auth_client
    r = _create_exercise(c, tok, evidence_tier="EXPERT_OPINION")
    assert r.status_code == 422


def test_create_exercise_without_tier_defaults_to_null(auth_client):
    """The 25 pre-existing seed exercises don't carry a tier. New
    user-created exercises also default to null — chip stays hidden."""
    c, tok, _ = auth_client
    r = _create_exercise(c, tok)
    assert r.status_code == 200
    assert r.json()["evidence_tier"] is None


def test_update_exercise_can_change_tier(auth_client):
    """ExerciseUpdate accepts evidence_tier so the operator can reclassify
    after seeding without going through the snapshot path. Pydantic
    Literal still rejects typos at the wire boundary."""
    c, tok, _ = auth_client
    created = _create_exercise(c, tok, evidence_tier="RCT").json()
    r = c.put(
        f"/exercises/{created['id']}",
        headers=_h(tok),
        json={"evidence_tier": "PRACTITIONER"},
    )
    assert r.status_code == 200
    assert r.json()["evidence_tier"] == "PRACTITIONER"
    # GET round-trip confirms persistence (not just response shape).
    fetched = c.get(f"/exercises/{created['id']}", headers=_h(tok)).json()
    assert fetched["evidence_tier"] == "PRACTITIONER"


def test_update_exercise_with_invalid_tier_returns_422(auth_client):
    c, tok, _ = auth_client
    created = _create_exercise(c, tok, evidence_tier="RCT").json()
    r = c.put(
        f"/exercises/{created['id']}",
        headers=_h(tok),
        json={"evidence_tier": "EXPERT_OPINION"},
    )
    assert r.status_code == 422


def test_update_exercise_omitting_tier_preserves_it(auth_client):
    """A PUT that doesn't mention evidence_tier must NOT clear it — the
    update path uses model_dump(exclude_unset=True) so absent fields
    don't generate `... = NULL` SET clauses."""
    c, tok, _ = auth_client
    created = _create_exercise(c, tok, evidence_tier="MECHANISM").json()
    r = c.put(
        f"/exercises/{created['id']}",
        headers=_h(tok),
        json={"name": "Renamed"},
    )
    assert r.status_code == 200
    assert r.json()["name"] == "Renamed"
    assert r.json()["evidence_tier"] == "MECHANISM"


def test_seed_from_snapshot_round_trips_tier(client, tmp_path):
    """The DR restore path must carry evidence_tier through. An earlier
    draft of seed_from_snapshot dropped the field, silently reverting
    every populated tier to NULL on the next snapshot load — exactly
    the failure mode this test guards."""
    import json
    from app.database import get_db
    import seed_workouts

    snap_path = tmp_path / "snap.json"
    snap_path.write_text(json.dumps({
        "version": 1,
        "captured_at": "2026-04-27T00:00:00Z",
        "exercises": [
            {
                "slug": "round_trip_a",
                "name": "Round Trip A",
                "category": "rehab",
                "primary_muscle": "test",
                "equipment": "none",
                "difficulty": 1,
                "is_bodyweight": True,
                "measurement": "duration",
                "instructions": None,
                "cue": None,
                "contraindications": None,
                "min_age": None,
                "max_age": None,
                "evidence_tier": "RCT",
                "images": [],
            },
            {
                "slug": "round_trip_b",
                "name": "Round Trip B",
                "category": "rehab",
                "primary_muscle": "test",
                "equipment": "none",
                "difficulty": 1,
                "is_bodyweight": True,
                "measurement": "reps",
                "instructions": None,
                "cue": None,
                "contraindications": None,
                "min_age": None,
                "max_age": None,
                "evidence_tier": None,
                "images": [],
            },
        ],
    }))

    n = seed_workouts.seed_from_snapshot(snap_path)
    assert n == 2

    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT slug, evidence_tier FROM exercises ORDER BY slug")
        rows = {r["slug"]: r["evidence_tier"] for r in cur.fetchall()}
    assert rows == {"round_trip_a": "RCT", "round_trip_b": None}

    # Re-running the snapshot must continue to round-trip the tier
    # (UPDATE branch, not INSERT). Earlier draft dropped tier on the
    # UPDATE path even when it was correct on INSERT.
    seed_workouts.seed_from_snapshot(snap_path)
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT slug, evidence_tier FROM exercises ORDER BY slug")
        rows = {r["slug"]: r["evidence_tier"] for r in cur.fetchall()}
    assert rows == {"round_trip_a": "RCT", "round_trip_b": None}


def test_seed_from_snapshot_overwrites_tier_on_existing_row(client, tmp_path):
    """The operator regrades an exercise from PRACTITIONER → MECHANISM
    in the curated snapshot. The next seed_from_snapshot run must apply
    the new value, not silently drop it."""
    import json
    from app.database import get_db
    import seed_workouts

    # Pre-populate row with one tier.
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute(
            """INSERT INTO exercises
               (user_id, name, slug, category, primary_muscle, equipment, difficulty,
                is_bodyweight, measurement, evidence_tier)
               VALUES (NULL, ?, ?, 'rehab', 'test', 'none', 1, ?, 'reps', ?)""",
            ("Initial", "regrade_me", True, "PRACTITIONER"),
        )

    snap_path = tmp_path / "snap.json"
    snap_path.write_text(json.dumps({
        "version": 1,
        "captured_at": "2026-04-27T00:00:00Z",
        "exercises": [{
            "slug": "regrade_me",
            "name": "Initial",
            "category": "rehab",
            "primary_muscle": "test",
            "equipment": "none",
            "difficulty": 1,
            "is_bodyweight": True,
            "measurement": "reps",
            "instructions": None,
            "cue": None,
            "contraindications": None,
            "min_age": None,
            "max_age": None,
            "evidence_tier": "MECHANISM",
            "images": [],
        }],
    }))

    seed_workouts.seed_from_snapshot(snap_path)
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT evidence_tier FROM exercises WHERE slug = 'regrade_me'")
        assert cur.fetchone()["evidence_tier"] == "MECHANISM"
