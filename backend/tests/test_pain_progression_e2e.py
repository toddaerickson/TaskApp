"""End-to-end test for pain-monitored progression.

Covers the round-trip that backs the Silbernagel feature:
1. A routine with tracks_symptoms=true propagates the flag to new sessions.
2. Sets logged against those sessions accept pain_score.
3. The PATCH endpoint backfills pain_score onto an existing set.
4. Strength sessions (tracks_symptoms=false) silently drop pain_score so it
   never leaks back into later suggestions.
5. /suggestions on a tracks_symptoms=true routine returns Silbernagel-shaped
   reasoning with policy="silbernagel" and a populated pain_last.
"""


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


def test_tracks_symptoms_roundtrips_through_routine_and_session(
    client, seeded_globals,
):
    """create routine with tracks_symptoms=true → start session → flag is
    snapshotted onto the session → log set with pain_score → read back."""
    tok = client.post(
        "/auth/register",
        json={"email": "pain1@x.com", "password": "pw1234567!"},
    ).json()["access_token"]

    # Create rehab routine.
    r = client.post(
        "/routines",
        headers=_h(tok),
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
    )
    assert r.status_code == 200, r.text
    routine = r.json()
    assert routine["tracks_symptoms"] is True

    # Start a session — flag should snapshot onto the session.
    r = client.post("/sessions", headers=_h(tok), json={"routine_id": routine["id"]})
    assert r.status_code == 200, r.text
    sess = r.json()
    assert sess["tracks_symptoms"] is True
    sid = sess["id"]
    ex_id = routine["exercises"][0]["exercise_id"]

    # Log a set with pain_score inline.
    r = client.post(
        f"/sessions/{sid}/sets",
        headers=_h(tok),
        json={"exercise_id": ex_id, "duration_sec": 30, "pain_score": 3},
    )
    assert r.status_code == 200, r.text
    set_row = r.json()
    assert set_row["pain_score"] == 3


def test_strength_session_silently_drops_pain_score(client, seeded_globals):
    """tracks_symptoms defaults false. Even if a client sends pain_score,
    the server drops it so it can't pollute future suggestions."""
    tok = client.post(
        "/auth/register",
        json={"email": "pain2@x.com", "password": "pw1234567!"},
    ).json()["access_token"]

    r = client.post(
        "/routines", headers=_h(tok),
        json={
            "name": "Strength",
            "exercises": [{
                "exercise_id": seeded_globals["bridge"],
                "target_sets": 3,
                "target_reps": 10,
            }],
        },
    )
    routine = r.json()
    assert routine["tracks_symptoms"] is False

    sess = client.post(
        "/sessions", headers=_h(tok),
        json={"routine_id": routine["id"]},
    ).json()
    assert sess["tracks_symptoms"] is False

    # Client sends pain_score — server drops it.
    r = client.post(
        f"/sessions/{sess['id']}/sets",
        headers=_h(tok),
        json={
            "exercise_id": routine["exercises"][0]["exercise_id"],
            "reps": 10,
            "pain_score": 9,
        },
    )
    assert r.status_code == 200
    assert r.json()["pain_score"] is None


def test_patch_set_backfills_pain_score(client, seeded_globals):
    """The per-exercise pain chip fires AFTER the last set is logged. It
    hits PATCH /sessions/sets/{id} with just pain_score; the server
    backfills without touching the other fields."""
    tok = client.post(
        "/auth/register",
        json={"email": "pain3@x.com", "password": "pw1234567!"},
    ).json()["access_token"]

    routine = client.post(
        "/routines", headers=_h(tok),
        json={
            "name": "R", "tracks_symptoms": True,
            "exercises": [{
                "exercise_id": seeded_globals["wall"],
                "target_sets": 1, "target_duration_sec": 30,
            }],
        },
    ).json()
    sess = client.post("/sessions", headers=_h(tok),
                      json={"routine_id": routine["id"]}).json()
    set_row = client.post(
        f"/sessions/{sess['id']}/sets",
        headers=_h(tok),
        json={"exercise_id": routine["exercises"][0]["exercise_id"],
              "duration_sec": 30},
    ).json()
    assert set_row["pain_score"] is None

    # Backfill pain via PATCH.
    r = client.patch(
        f"/sessions/sets/{set_row['id']}",
        headers=_h(tok),
        json={"pain_score": 2},
    )
    assert r.status_code == 200, r.text
    assert r.json()["pain_score"] == 2
    assert r.json()["duration_sec"] == 30  # untouched


def test_patch_set_can_correct_performance_fields(client, seeded_globals):
    """The tap-row-to-edit sheet sends PATCH with reps / weight / etc.
    when the user fixes a mis-typed set. Allow-list was expanded for
    this flow; verify each field round-trips and leaves the others
    untouched.
    """
    tok = client.post(
        "/auth/register",
        json={"email": "edit1@x.com", "password": "pw1234567!"},
    ).json()["access_token"]

    routine = client.post(
        "/routines", headers=_h(tok),
        json={
            "name": "R",
            "exercises": [{
                "exercise_id": seeded_globals["bridge"],
                "target_sets": 3, "target_reps": 10,
            }],
        },
    ).json()
    sess = client.post("/sessions", headers=_h(tok),
                      json={"routine_id": routine["id"]}).json()
    ex_id = routine["exercises"][0]["exercise_id"]
    set_row = client.post(
        f"/sessions/{sess['id']}/sets",
        headers=_h(tok),
        json={"exercise_id": ex_id, "reps": 8, "weight": 50.0, "rpe": 7},
    ).json()

    # User realizes they typed 8 reps but did 10 — correct it.
    r = client.patch(
        f"/sessions/sets/{set_row['id']}",
        headers=_h(tok),
        json={"reps": 10},
    )
    assert r.status_code == 200, r.text
    fixed = r.json()
    assert fixed["reps"] == 10
    # Untouched fields preserved.
    assert fixed["weight"] == 50.0
    assert fixed["rpe"] == 7

    # Multi-field edit (weight + rpe at once).
    r2 = client.patch(
        f"/sessions/sets/{set_row['id']}",
        headers=_h(tok),
        json={"weight": 55.0, "rpe": 8, "notes": "bumped 5 lb"},
    )
    assert r2.status_code == 200
    body = r2.json()
    assert body["weight"] == 55.0
    assert body["rpe"] == 8
    assert body["notes"] == "bumped 5 lb"
    assert body["reps"] == 10  # still the corrected value

    # Structural fields are not in the allow-list — even if sent, must
    # not clobber. Pydantic filters unknowns by default; verify via
    # round-trip.
    r3 = client.patch(
        f"/sessions/sets/{set_row['id']}",
        headers=_h(tok),
        json={"reps": 11, "set_number": 99, "session_id": 99999},
    )
    assert r3.status_code == 200
    assert r3.json()["reps"] == 11
    assert r3.json()["set_number"] == set_row["set_number"]  # unchanged
    assert r3.json()["session_id"] == sess["id"]  # unchanged


def test_patch_set_on_strength_session_drops_pain_score(client, seeded_globals):
    """Same PATCH shape but the parent session is tracks_symptoms=false:
    the value is silently dropped (mirrors the POST log_set behavior)."""
    tok = client.post(
        "/auth/register",
        json={"email": "pain4@x.com", "password": "pw1234567!"},
    ).json()["access_token"]

    routine = client.post(
        "/routines", headers=_h(tok),
        json={
            "name": "R",
            "exercises": [{
                "exercise_id": seeded_globals["wall"],
                "target_sets": 1, "target_duration_sec": 30,
            }],
        },
    ).json()
    sess = client.post("/sessions", headers=_h(tok),
                      json={"routine_id": routine["id"]}).json()
    set_row = client.post(
        f"/sessions/{sess['id']}/sets",
        headers=_h(tok),
        json={"exercise_id": routine["exercises"][0]["exercise_id"],
              "duration_sec": 30},
    ).json()

    r = client.patch(
        f"/sessions/sets/{set_row['id']}",
        headers=_h(tok),
        json={"pain_score": 8},
    )
    assert r.status_code == 200
    assert r.json()["pain_score"] is None


def test_suggestions_return_silbernagel_policy_when_routine_tracks_symptoms(
    client, seeded_globals,
):
    """A rehab routine + a completed session with pain_score yields a
    /suggestions response carrying policy='silbernagel' and pain_last."""
    tok = client.post(
        "/auth/register",
        json={"email": "pain5@x.com", "password": "pw1234567!"},
    ).json()["access_token"]

    routine = client.post(
        "/routines", headers=_h(tok),
        json={
            "name": "R", "tracks_symptoms": True,
            "exercises": [{
                "exercise_id": seeded_globals["bridge"],
                "target_sets": 3, "target_reps": 10,
            }],
        },
    ).json()
    sess = client.post("/sessions", headers=_h(tok),
                      json={"routine_id": routine["id"]}).json()
    ex_id = routine["exercises"][0]["exercise_id"]
    # Three sets, all hitting target, low pain.
    for _ in range(3):
        client.post(
            f"/sessions/{sess['id']}/sets",
            headers=_h(tok),
            json={"exercise_id": ex_id, "reps": 10, "pain_score": 2},
        )

    sugs = client.get(
        f"/routines/{routine['id']}/suggestions",
        headers=_h(tok),
    ).json()
    assert len(sugs) == 1
    s = sugs[0]
    assert s["policy"] == "silbernagel"
    assert s["pain_last"] == 2
    # Low pain + hit target → +2 reps on bodyweight exercise.
    assert s["reps"] == 12


def test_suggestions_ignore_pain_when_routine_tracks_symptoms_false(
    client, seeded_globals,
):
    """A strength routine never runs Silbernagel even if legacy pain
    scores slipped through (they shouldn't, but the dispatcher is the
    last line of defense)."""
    tok = client.post(
        "/auth/register",
        json={"email": "pain6@x.com", "password": "pw1234567!"},
    ).json()["access_token"]

    routine = client.post(
        "/routines", headers=_h(tok),
        json={
            "name": "R",
            "exercises": [{
                "exercise_id": seeded_globals["bridge"],
                "target_sets": 3, "target_reps": 10,
            }],
        },
    ).json()
    sess = client.post("/sessions", headers=_h(tok),
                      json={"routine_id": routine["id"]}).json()
    ex_id = routine["exercises"][0]["exercise_id"]
    for _ in range(3):
        client.post(
            f"/sessions/{sess['id']}/sets",
            headers=_h(tok),
            json={"exercise_id": ex_id, "reps": 10, "rpe": 6},
        )

    sugs = client.get(
        f"/routines/{routine['id']}/suggestions",
        headers=_h(tok),
    ).json()
    assert sugs[0]["policy"] is None
    assert sugs[0]["pain_last"] is None
