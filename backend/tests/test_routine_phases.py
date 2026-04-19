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
