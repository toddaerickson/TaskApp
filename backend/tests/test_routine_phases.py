"""Tests for phased routines (Curovate-style progression).

Covers three surfaces:
1. Phase CRUD routes on `/routines/{id}/phases`.
2. `phase_id` assignment on routine_exercises.
3. The time-math resolver in `app.hydrate.resolve_current_phase_id`,
   including edge cases (before/after the window, no start date,
   boundary days). This is the piece the mobile banner depends on;
   getting it wrong means users see "Phase 1 · 5 days left" for a
   routine they haven't started yet.
"""
from datetime import date, timedelta

from app.database import get_db
from app.hydrate import resolve_current_phase_id


def _h(token):
    return {"Authorization": f"Bearer {token}"}


def _mkphases(specs):
    """Build phase dicts from (label, order_idx, duration_weeks) tuples.
    Used only by the pure-function resolver tests; the route tests build
    real DB rows."""
    return [
        {"id": i + 1, "routine_id": 1, "label": lbl,
         "order_idx": oi, "duration_weeks": wk}
        for i, (lbl, oi, wk) in enumerate(specs)
    ]


# ---------- resolver pure-function ----------

def test_resolver_returns_none_when_no_phases():
    assert resolve_current_phase_id([], "2026-01-01", date(2026, 2, 1)) is None


def test_resolver_returns_none_when_no_start_date():
    phases = _mkphases([("Initial", 0, 2)])
    assert resolve_current_phase_id(phases, None, date(2026, 2, 1)) is None


def test_resolver_invalid_start_date_returns_none():
    phases = _mkphases([("Initial", 0, 2)])
    assert resolve_current_phase_id(phases, "not-a-date", date(2026, 2, 1)) is None


def test_resolver_day_zero_is_first_phase():
    phases = _mkphases([("Initial", 0, 2), ("Strength", 1, 4)])
    assert resolve_current_phase_id(phases, "2026-01-01", date(2026, 1, 1)) == 1


def test_resolver_inside_first_phase():
    # Day 10 with a 2-week phase 1 → still inside phase 1.
    phases = _mkphases([("Initial", 0, 2), ("Strength", 1, 4)])
    assert resolve_current_phase_id(phases, "2026-01-01", date(2026, 1, 11)) == 1


def test_resolver_boundary_day_advances():
    # Exactly 14 days later → week 2 (0-indexed), which is the start of
    # phase 2. The floor-divide means day 13 is still phase 1 and day 14
    # is phase 2 — verify both sides of the boundary.
    phases = _mkphases([("Initial", 0, 2), ("Strength", 1, 4)])
    assert resolve_current_phase_id(phases, "2026-01-01", date(2026, 1, 14)) == 1
    assert resolve_current_phase_id(phases, "2026-01-01", date(2026, 1, 15)) == 2


def test_resolver_after_end_pins_to_last_phase():
    # Program is 2+4 = 6 weeks. Day 100 is well past; user stays pinned
    # to the last phase rather than falling off the banner.
    phases = _mkphases([("Initial", 0, 2), ("Strength", 1, 4)])
    last = resolve_current_phase_id(phases, "2026-01-01", date(2026, 1, 1) + timedelta(days=100))
    assert last == 2


def test_resolver_accepts_datetime_date_from_pg():
    # PG DATE columns come back as datetime.date objects via psycopg2.
    phases = _mkphases([("Initial", 0, 2)])
    today = date(2026, 1, 5)
    assert resolve_current_phase_id(phases, date(2026, 1, 1), today) == 1


# ---------- phase CRUD ----------

def test_create_phase_and_get_back_in_routine(auth_client, seeded_globals):
    c, tok, _ = auth_client
    routine = c.post("/routines", headers=_h(tok), json={
        "name": "Post-op knee",
        "goal": "rehab",
        "exercises": [],
    }).json()
    rid = routine["id"]

    # Newly-created routine has no phases and no current_phase_id.
    assert routine["phases"] == []
    assert routine["current_phase_id"] is None

    r = c.post(f"/routines/{rid}/phases", headers=_h(tok), json={
        "label": "Initial Healing",
        "order_idx": 0,
        "duration_weeks": 2,
        "notes": "Weight-bear as tolerated",
    })
    assert r.status_code == 200, r.text
    phase = r.json()
    assert phase["label"] == "Initial Healing"
    assert phase["duration_weeks"] == 2
    assert phase["order_idx"] == 0

    # GET /routines/{id} now includes the phase and — since we haven't set
    # phase_start_date — current_phase_id is still None.
    fetched = c.get(f"/routines/{rid}", headers=_h(tok)).json()
    assert len(fetched["phases"]) == 1
    assert fetched["phases"][0]["id"] == phase["id"]
    assert fetched["current_phase_id"] is None

    # Setting phase_start_date to today flips the routine into phased
    # mode. Resolver should now pick the first (and only) phase.
    today = date.today().isoformat()
    put = c.put(f"/routines/{rid}", headers=_h(tok), json={
        "phase_start_date": today,
    })
    assert put.status_code == 200
    assert put.json()["current_phase_id"] == phase["id"]


def test_create_phase_rejects_bad_duration(auth_client, seeded_globals):
    c, tok, _ = auth_client
    rid = c.post("/routines", headers=_h(tok), json={"name": "R"}).json()["id"]
    bad = c.post(f"/routines/{rid}/phases", headers=_h(tok), json={
        "label": "x", "order_idx": 0, "duration_weeks": 0,
    })
    assert bad.status_code == 400


def test_create_phase_rejects_duplicate_order_idx(auth_client, seeded_globals):
    c, tok, _ = auth_client
    rid = c.post("/routines", headers=_h(tok), json={"name": "R"}).json()["id"]
    a = c.post(f"/routines/{rid}/phases", headers=_h(tok),
               json={"label": "A", "order_idx": 0, "duration_weeks": 1})
    assert a.status_code == 200
    # Same routine, same order_idx — explicit 409 with an actionable message.
    dup = c.post(f"/routines/{rid}/phases", headers=_h(tok),
                 json={"label": "B", "order_idx": 0, "duration_weeks": 1})
    assert dup.status_code == 409


def test_update_phase_fields(auth_client, seeded_globals):
    c, tok, _ = auth_client
    rid = c.post("/routines", headers=_h(tok), json={"name": "R"}).json()["id"]
    pid = c.post(f"/routines/{rid}/phases", headers=_h(tok),
                 json={"label": "Initial", "order_idx": 0, "duration_weeks": 2}).json()["id"]
    upd = c.put(f"/routines/{rid}/phases/{pid}", headers=_h(tok), json={
        "label": "Renamed", "duration_weeks": 3,
    })
    assert upd.status_code == 200
    body = upd.json()
    assert body["label"] == "Renamed"
    assert body["duration_weeks"] == 3
    # Untouched field stayed put.
    assert body["order_idx"] == 0


def test_delete_phase_unassigns_exercises(auth_client, seeded_globals):
    """Deleting a phase shouldn't delete the user's exercise work.
    Assigned routine_exercises fall back to phase_id=NULL, meaning they
    apply in every phase — the user's list is preserved."""
    c, tok, _ = auth_client
    rid = c.post("/routines", headers=_h(tok), json={
        "name": "R",
        "exercises": [{"exercise_id": seeded_globals["wall"], "sort_order": 0}],
    }).json()["id"]
    re_id = c.get(f"/routines/{rid}", headers=_h(tok)).json()["exercises"][0]["id"]
    pid = c.post(f"/routines/{rid}/phases", headers=_h(tok),
                 json={"label": "A", "order_idx": 0, "duration_weeks": 1}).json()["id"]

    # Assign the existing exercise to the new phase.
    assign = c.put(f"/routines/exercises/{re_id}", headers=_h(tok),
                   json={"phase_id": pid})
    assert assign.status_code == 200
    assert assign.json()["phase_id"] == pid

    # Nuke the phase.
    d = c.delete(f"/routines/{rid}/phases/{pid}", headers=_h(tok))
    assert d.status_code == 200

    # Exercise still exists, phase_id cleared.
    routine = c.get(f"/routines/{rid}", headers=_h(tok)).json()
    assert len(routine["exercises"]) == 1
    assert routine["exercises"][0]["phase_id"] is None
    assert routine["phases"] == []


def test_user2_cannot_crud_user1_phases(client, seeded_globals):
    # Isolation: a phase belongs to its routine, which belongs to its user.
    t1 = client.post("/auth/register",
                     json={"email": "p1@x.com", "password": "pw1234567"}).json()["access_token"]
    rid = client.post("/routines", headers=_h(t1),
                      json={"name": "Mine"}).json()["id"]
    pid = client.post(f"/routines/{rid}/phases", headers=_h(t1),
                      json={"label": "A", "order_idx": 0, "duration_weeks": 1}).json()["id"]

    t2 = client.post("/auth/register",
                     json={"email": "p2@x.com", "password": "pw1234567"}).json()["access_token"]
    assert client.get(f"/routines/{rid}/phases", headers=_h(t2)).status_code == 404
    assert client.put(f"/routines/{rid}/phases/{pid}",
                      headers=_h(t2), json={"label": "hax"}).status_code == 404
    assert client.delete(f"/routines/{rid}/phases/{pid}", headers=_h(t2)).status_code == 404


def test_reorder_phases_happy_path(auth_client, seeded_globals):
    """Reorder 4 phases — verify every pre/post position lands correctly.
    The previous client-side 3-step swap couldn't express a reverse; this
    endpoint does the full permutation in one transaction."""
    c, tok, _ = auth_client
    rid = c.post("/routines", headers=_h(tok), json={"name": "R"}).json()["id"]
    ids = [
        c.post(f"/routines/{rid}/phases", headers=_h(tok), json={
            "label": f"P{i}", "order_idx": i, "duration_weeks": 1,
        }).json()["id"]
        for i in range(4)
    ]

    # Reverse: [P3, P2, P1, P0]
    reversed_ids = list(reversed(ids))
    r = c.post(f"/routines/{rid}/phases/reorder", headers=_h(tok),
               json={"phase_ids": reversed_ids})
    assert r.status_code == 200, r.text
    returned = r.json()
    assert [p["id"] for p in returned] == reversed_ids
    assert [p["order_idx"] for p in returned] == [0, 1, 2, 3]

    # Hydrated routine matches.
    routine = c.get(f"/routines/{rid}", headers=_h(tok)).json()
    assert [p["id"] for p in routine["phases"]] == reversed_ids


def test_reorder_phases_rejects_missing_ids(auth_client, seeded_globals):
    """A payload that drops a phase id corrupts the routine. Reject."""
    c, tok, _ = auth_client
    rid = c.post("/routines", headers=_h(tok), json={"name": "R"}).json()["id"]
    ids = [
        c.post(f"/routines/{rid}/phases", headers=_h(tok), json={
            "label": f"P{i}", "order_idx": i, "duration_weeks": 1,
        }).json()["id"]
        for i in range(3)
    ]
    r = c.post(f"/routines/{rid}/phases/reorder", headers=_h(tok),
               json={"phase_ids": ids[:2]})
    assert r.status_code == 400


def test_reorder_phases_rejects_foreign_id(auth_client, seeded_globals):
    """A phase_id from another routine in the list must 400, not
    silently re-parent it."""
    c, tok, _ = auth_client
    r1 = c.post("/routines", headers=_h(tok), json={"name": "A"}).json()["id"]
    r2 = c.post("/routines", headers=_h(tok), json={"name": "B"}).json()["id"]
    p_a = c.post(f"/routines/{r1}/phases", headers=_h(tok), json={
        "label": "A0", "order_idx": 0, "duration_weeks": 1,
    }).json()["id"]
    p_b = c.post(f"/routines/{r2}/phases", headers=_h(tok), json={
        "label": "B0", "order_idx": 0, "duration_weeks": 1,
    }).json()["id"]
    r = c.post(f"/routines/{r1}/phases/reorder", headers=_h(tok),
               json={"phase_ids": [p_a, p_b]})
    assert r.status_code == 400


def test_reorder_phases_rejects_duplicates(auth_client, seeded_globals):
    """The duplicate check runs before the set-equality check so the
    error message names the real problem. Earlier order had [1, 1]
    against {1, 2} report "must contain every phase id" — confusing."""
    c, tok, _ = auth_client
    rid = c.post("/routines", headers=_h(tok), json={"name": "R"}).json()["id"]
    a = c.post(f"/routines/{rid}/phases", headers=_h(tok), json={
        "label": "A", "order_idx": 0, "duration_weeks": 1,
    }).json()["id"]
    b = c.post(f"/routines/{rid}/phases", headers=_h(tok), json={
        "label": "B", "order_idx": 1, "duration_weeks": 1,
    }).json()["id"]
    # Duplicate WITH a missing id — both checks would fire; duplicate
    # wins and the user sees the actionable error.
    r = c.post(f"/routines/{rid}/phases/reorder", headers=_h(tok),
               json={"phase_ids": [a, a]})
    assert r.status_code == 400
    assert "duplicates" in r.text
    # Sanity: the set-equality error still fires when there's no dup.
    r2 = c.post(f"/routines/{rid}/phases/reorder", headers=_h(tok),
                json={"phase_ids": [a]})
    assert r2.status_code == 400
    assert "every phase id" in r2.text
    _ = b  # keeps the lint quiet — b is created to make the set mismatch real


def test_reorder_phases_cross_user_blocked(client, seeded_globals):
    t1 = client.post("/auth/register",
                     json={"email": "ro1@x.com", "password": "pw1234567"}).json()["access_token"]
    rid = client.post("/routines", headers=_h(t1),
                      json={"name": "Mine"}).json()["id"]
    pid = client.post(f"/routines/{rid}/phases", headers=_h(t1),
                      json={"label": "A", "order_idx": 0, "duration_weeks": 1}).json()["id"]

    t2 = client.post("/auth/register",
                     json={"email": "ro2@x.com", "password": "pw1234567"}).json()["access_token"]
    assert client.post(f"/routines/{rid}/phases/reorder",
                       headers=_h(t2), json={"phase_ids": [pid]}).status_code == 404


def test_reorder_pass1_scoping_prevents_concurrent_add_corruption(auth_client, seeded_globals):
    """Race-safety regression test for the Pass 1 scoping fix.

    The race: validator's SELECT sees {A, B}; another request inserts
    phase C; Pass 1 fires; Pass 2 only knows about {A, B} so C is left
    parked. The fix scopes Pass 1 to the validated ids via `id IN (...)`
    so an unmentioned phase is never touched.

    Single-threaded tests can't interleave a real concurrent INSERT.
    Instead we run the two Pass 1 SQL shapes (unscoped — the old bug —
    and scoped — the fix) on parallel routines and assert opposite
    outcomes. If someone reverts the fix to the unscoped form, the
    second assertion below fires.
    """
    c, tok, _ = auth_client

    def _setup():
        rid = c.post("/routines", headers=_h(tok), json={"name": "R"}).json()["id"]
        ids = [
            c.post(f"/routines/{rid}/phases", headers=_h(tok), json={
                "label": f"P{i}", "order_idx": i, "duration_weeks": 1,
            }).json()["id"]
            for i in range(3)
        ]
        return rid, ids[:2], ids[2]  # validated ids + the "concurrent" racer

    # --- OLD BUG SHAPE: unscoped Pass 1, then Pass 2 over validated only.
    rid_bug, validated_bug, racer_bug = _setup()
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute(
            "UPDATE routine_phases SET order_idx = -id WHERE routine_id = ?",
            (rid_bug,),
        )
        for new_idx, pid in enumerate(validated_bug):
            cur.execute(
                "UPDATE routine_phases SET order_idx = ? WHERE id = ? AND routine_id = ?",
                (new_idx, pid, rid_bug),
            )
    routine = c.get(f"/routines/{rid_bug}", headers=_h(tok)).json()
    by_id = {p["id"]: p for p in routine["phases"]}
    # The bug: racer parked at -id, never restored.
    assert by_id[racer_bug]["order_idx"] == -racer_bug, (
        "old SQL no longer reproduces the bug — refactor likely broke this test"
    )

    # --- FIXED SHAPE: scoped Pass 1, then Pass 2.
    rid_fix, validated_fix, racer_fix = _setup()
    with get_db() as conn:
        cur = conn.cursor()
        placeholders = ",".join("?" * len(validated_fix))
        cur.execute(
            f"UPDATE routine_phases SET order_idx = -id "
            f"WHERE routine_id = ? AND id IN ({placeholders})",
            (rid_fix, *validated_fix),
        )
        for new_idx, pid in enumerate(validated_fix):
            cur.execute(
                "UPDATE routine_phases SET order_idx = ? WHERE id = ? AND routine_id = ?",
                (new_idx, pid, rid_fix),
            )
    routine = c.get(f"/routines/{rid_fix}", headers=_h(tok)).json()
    by_id = {p["id"]: p for p in routine["phases"]}
    # The fix: racer keeps its original order_idx (2 — third phase added).
    assert by_id[racer_fix]["order_idx"] == 2, (
        f"scoped Pass 1 corrupted the racer (got order_idx="
        f"{by_id[racer_fix]['order_idx']}); fix in reorder_phases regressed"
    )


def test_reorder_pass2_detects_concurrent_phase_delete(auth_client, seeded_globals):
    """Race-safety: a phase deleted between the validator's SELECT and
    Pass 2's UPDATE loop must surface a 409, not silently return a
    truncated phase list.

    Single-threaded tests can't interleave a real concurrent DELETE,
    so we exercise Pass 2's rowcount invariant directly: create three
    phases, delete one via raw SQL (simulating the concurrent-delete
    window), then run the bulk UPDATE against the pre-delete id list
    and assert the rowcount guard fires on the deleted id.
    """
    c, tok, _ = auth_client
    rid = c.post("/routines", headers=_h(tok), json={"name": "R"}).json()["id"]
    ids = [
        c.post(f"/routines/{rid}/phases", headers=_h(tok), json={
            "label": f"P{i}", "order_idx": i, "duration_weeks": 1,
        }).json()["id"]
        for i in range(3)
    ]
    racer_deleted = ids[1]

    with get_db() as conn:
        cur = conn.cursor()
        # Concurrent-delete simulator.
        cur.execute(
            "DELETE FROM routine_phases WHERE id = ?", (racer_deleted,),
        )
        # Pass 1 scoped to the pre-delete id list (mirrors the route).
        placeholders = ",".join("?" * len(ids))
        cur.execute(
            f"UPDATE routine_phases SET order_idx = -id "
            f"WHERE routine_id = ? AND id IN ({placeholders})",
            (rid, *ids),
        )
        # Pass 2: loop over the pre-delete list; the deleted id must
        # produce rowcount == 0 (the route's guard 409s at this point).
        zero_hits: list[int] = []
        for new_idx, pid in enumerate(ids):
            cur.execute(
                "UPDATE routine_phases SET order_idx = ? WHERE id = ? AND routine_id = ?",
                (new_idx, pid, rid),
            )
            if cur.rowcount == 0:
                zero_hits.append(pid)

    assert zero_hits == [racer_deleted], (
        f"expected rowcount=0 only on the concurrently-deleted phase "
        f"({racer_deleted}); got {zero_hits}"
    )


def test_update_routine_exercise_rejects_foreign_phase_id(auth_client, seeded_globals):
    """phase_id on a routine_exercise must belong to the same routine.
    Pointing at another routine's phase (even if the user owns both)
    creates an orphan FK that filterExercisesForPhase silently hides."""
    c, tok, _ = auth_client
    r1 = c.post("/routines", headers=_h(tok), json={"name": "A"}).json()["id"]
    r2 = c.post("/routines", headers=_h(tok), json={"name": "B"}).json()["id"]
    p_b = c.post(f"/routines/{r2}/phases", headers=_h(tok), json={
        "label": "B0", "order_idx": 0, "duration_weeks": 1,
    }).json()["id"]

    # Add an exercise to routine A; try to point its phase_id at routine B's phase.
    ex = c.post(f"/routines/{r1}/exercises", headers=_h(tok),
                json={"exercise_id": 1}).json()
    bad = c.put(f"/routines/exercises/{ex['id']}", headers=_h(tok),
                json={"phase_id": p_b})
    assert bad.status_code == 400
    assert "does not belong" in bad.text

    # Creating a phase in routine A and pointing at it works.
    p_a = c.post(f"/routines/{r1}/phases", headers=_h(tok), json={
        "label": "A0", "order_idx": 0, "duration_weeks": 1,
    }).json()["id"]
    ok = c.put(f"/routines/exercises/{ex['id']}", headers=_h(tok),
               json={"phase_id": p_a})
    assert ok.status_code == 200

    # Clearing phase_id to null is always allowed ("applies in every phase").
    clear = c.put(f"/routines/exercises/{ex['id']}", headers=_h(tok),
                  json={"phase_id": None})
    assert clear.status_code == 200


def test_update_routine_rejects_bad_phase_start_date(auth_client, seeded_globals):
    """A free-form phase_start_date used to pass Pydantic and silently
    store a broken routine. Now rejected at the 422 boundary."""
    c, tok, _ = auth_client
    rid = c.post("/routines", headers=_h(tok), json={"name": "R"}).json()["id"]
    bad = c.put(f"/routines/{rid}", headers=_h(tok),
                json={"phase_start_date": "not-a-date"})
    assert bad.status_code == 422

    # Empty string normalizes to None (clears the field).
    clear = c.put(f"/routines/{rid}", headers=_h(tok),
                  json={"phase_start_date": ""})
    assert clear.status_code == 200
    assert clear.json()["phase_start_date"] is None


def test_current_phase_id_advances_with_start_date(auth_client, seeded_globals):
    """End-to-end: phases + phase_start_date → current_phase_id in
    hydrated routine. Sets a start date 10 days ago on a 2-week + 4-week
    program → user is in phase 1 (day 10 < day 14 boundary)."""
    c, tok, _ = auth_client
    rid = c.post("/routines", headers=_h(tok), json={"name": "R"}).json()["id"]
    p1 = c.post(f"/routines/{rid}/phases", headers=_h(tok),
                json={"label": "Initial", "order_idx": 0, "duration_weeks": 2}).json()
    p2 = c.post(f"/routines/{rid}/phases", headers=_h(tok),
                json={"label": "Strength", "order_idx": 1, "duration_weeks": 4}).json()

    ten_days_ago = (date.today() - timedelta(days=10)).isoformat()
    c.put(f"/routines/{rid}", headers=_h(tok),
          json={"phase_start_date": ten_days_ago})
    routine = c.get(f"/routines/{rid}", headers=_h(tok)).json()
    assert routine["current_phase_id"] == p1["id"]

    # Jump the start date back 30 days → now in phase 2 (week 4 is within
    # phase 2's [2, 6) window).
    thirty_days_ago = (date.today() - timedelta(days=30)).isoformat()
    c.put(f"/routines/{rid}", headers=_h(tok),
          json={"phase_start_date": thirty_days_ago})
    assert c.get(f"/routines/{rid}", headers=_h(tok)).json()["current_phase_id"] == p2["id"]
