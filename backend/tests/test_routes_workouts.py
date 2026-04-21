"""Route-level tests for the workout module: routines, sessions, suggestions,
auth scoping, and the race-safe set-logging path."""
import concurrent.futures


def _h(token):
    return {"Authorization": f"Bearer {token}"}


# ---------- Exercises (auth scoping) ----------

def test_unauthenticated_users_see_nothing(client, seeded_globals):
    r = client.get("/exercises")
    assert r.status_code in (401, 403)


def test_global_exercises_visible_to_any_user(auth_client, seeded_globals):
    c, tok, _ = auth_client
    r = c.get("/exercises", headers=_h(tok))
    assert r.status_code == 200
    slugs = {e["slug"] for e in r.json()}
    assert "wall_ankle_dorsiflexion" in slugs


def test_user_can_delete_global_exercise(auth_client, seeded_globals):
    """Single-user self-hosted: the seeded "global" library is effectively
    the user's own pre-populated data. The 403 guard on global delete
    was dropped to unblock pruning/renaming. Cross-user-owned deletes
    still 403 (covered in test_symptom_crud.py)."""
    c, tok, _ = auth_client
    r = c.delete(f"/exercises/{seeded_globals['wall']}", headers=_h(tok))
    assert r.status_code == 200


def test_user_can_edit_global_exercise(auth_client, seeded_globals):
    """We deliberately loosened this for the self-hosted single-user case."""
    c, tok, _ = auth_client
    r = c.put(
        f"/exercises/{seeded_globals['wall']}",
        headers=_h(tok),
        json={"cue": "Updated cue text"},
    )
    assert r.status_code == 200
    assert r.json()["cue"] == "Updated cue text"


# ---------- Routines ----------

def test_create_and_fetch_routine(auth_client, seeded_globals):
    c, tok, _ = auth_client
    r = c.post("/routines", headers=_h(tok), json={
        "name": "Morning",
        "exercises": [
            {"exercise_id": seeded_globals["wall"], "target_sets": 2, "target_duration_sec": 120, "keystone": True},
            {"exercise_id": seeded_globals["bridge"], "target_sets": 3, "target_reps": 12},
        ],
    })
    assert r.status_code == 200
    routine = r.json()
    assert routine["name"] == "Morning"
    assert len(routine["exercises"]) == 2
    assert routine["exercises"][0]["keystone"] is True

    # Get returns same shape with hydrated exercises.
    r2 = c.get(f"/routines/{routine['id']}", headers=_h(tok))
    assert r2.status_code == 200
    assert len(r2.json()["exercises"]) == 2


def test_user2_cannot_see_user1_routine(client, seeded_globals):
    # User 1 creates a routine.
    t1 = client.post("/auth/register", json={"email": "u1@x.com", "password": "pw1234567"}).json()["access_token"]
    r = client.post("/routines", headers=_h(t1), json={"name": "Mine", "exercises": []})
    rid = r.json()["id"]

    # User 2 cannot see it in their list and cannot fetch it directly.
    t2 = client.post("/auth/register", json={"email": "u2@x.com", "password": "pw1234567"}).json()["access_token"]
    assert client.get("/routines", headers=_h(t2)).json() == []
    r404 = client.get(f"/routines/{rid}", headers=_h(t2))
    assert r404.status_code == 404


def test_routine_reorder_persists(auth_client, seeded_globals):
    c, tok, _ = auth_client
    r = c.post("/routines", headers=_h(tok), json={
        "name": "T",
        "exercises": [
            {"exercise_id": seeded_globals["wall"], "sort_order": 0},
            {"exercise_id": seeded_globals["bridge"], "sort_order": 1},
        ],
    }).json()
    rid = r["id"]
    re_ids = [re["id"] for re in r["exercises"]]

    # Reverse the order.
    rr = c.post(
        f"/routines/{rid}/reorder",
        headers=_h(tok),
        json={"routine_exercise_ids": list(reversed(re_ids))},
    )
    assert rr.status_code == 200
    fetched = c.get(f"/routines/{rid}", headers=_h(tok)).json()
    assert [re["id"] for re in fetched["exercises"]] == list(reversed(re_ids))


# ---------- Sessions: race-safe set logging ----------

def _make_routine_and_session(c, tok, ex_id):
    r = c.post("/routines", headers=_h(tok), json={
        "name": "T",
        "exercises": [{"exercise_id": ex_id, "target_sets": 5, "target_reps": 10}],
    }).json()
    s = c.post("/sessions", headers=_h(tok), json={"routine_id": r["id"]}).json()
    return r["id"], s["id"]


def test_set_number_assigned_server_side(auth_client, seeded_globals):
    c, tok, _ = auth_client
    _, sid = _make_routine_and_session(c, tok, seeded_globals["bridge"])
    for _ in range(3):
        r = c.post(f"/sessions/{sid}/sets", headers=_h(tok),
                   json={"exercise_id": seeded_globals["bridge"], "reps": 12})
        assert r.status_code == 200
    sess = c.get(f"/sessions/{sid}", headers=_h(tok)).json()
    nums = sorted(s["set_number"] for s in sess["sets"])
    assert nums == [1, 2, 3]


def test_concurrent_set_logs_get_unique_numbers(auth_client, seeded_globals):
    """The UNIQUE INDEX + retry loop must yield unique sequential set_numbers
    even under simultaneous double-tap."""
    c, tok, _ = auth_client
    _, sid = _make_routine_and_session(c, tok, seeded_globals["bridge"])

    def log():
        return c.post(f"/sessions/{sid}/sets", headers=_h(tok),
                      json={"exercise_id": seeded_globals["bridge"], "reps": 10}).status_code

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex:
        codes = list(ex.map(lambda _: log(), range(8)))

    # All 8 should land (no 5xx, no 409 — the retry loop covers up to 10 attempts).
    assert all(code == 200 for code in codes), f"got {codes}"
    sess = c.get(f"/sessions/{sid}", headers=_h(tok)).json()
    nums = sorted(s["set_number"] for s in sess["sets"])
    assert nums == list(range(1, 9)), f"expected 1..8, got {nums}"
    assert len(set(nums)) == len(nums), "set_numbers must be unique"


def test_finishing_session_updates_rpe_mood(auth_client, seeded_globals):
    c, tok, _ = auth_client
    _, sid = _make_routine_and_session(c, tok, seeded_globals["bridge"])
    r = c.put(f"/sessions/{sid}", headers=_h(tok),
              json={"ended_at": "2026-04-13T12:00:00Z", "rpe": 7, "mood": 4})
    assert r.status_code == 200
    body = r.json()
    assert body["rpe"] == 7
    assert body["mood"] == 4
    assert body["ended_at"] is not None


# ---------- Suggestions endpoint ----------

def test_suggestions_with_no_history_echoes_target(auth_client, seeded_globals):
    c, tok, _ = auth_client
    r = c.post("/routines", headers=_h(tok), json={
        "name": "T",
        "exercises": [
            {"exercise_id": seeded_globals["wall"], "target_sets": 2, "target_duration_sec": 120},
            {"exercise_id": seeded_globals["bridge"], "target_sets": 3, "target_reps": 12},
        ],
    }).json()
    sugs = c.get(f"/routines/{r['id']}/suggestions", headers=_h(tok)).json()
    by_ex = {s["exercise_id"]: s for s in sugs}
    assert by_ex[seeded_globals["wall"]]["duration_sec"] == 120
    assert by_ex[seeded_globals["bridge"]]["reps"] == 12
    assert "no prior" in by_ex[seeded_globals["wall"]]["reason"].lower()


def test_suggestions_after_easy_session_bumps_targets(auth_client, seeded_globals):
    c, tok, _ = auth_client
    r = c.post("/routines", headers=_h(tok), json={
        "name": "T",
        "exercises": [
            {"exercise_id": seeded_globals["bridge"], "target_sets": 3, "target_reps": 12},
        ],
    }).json()
    sess = c.post("/sessions", headers=_h(tok), json={"routine_id": r["id"]}).json()
    c.post(f"/sessions/{sess['id']}/sets", headers=_h(tok),
           json={"exercise_id": seeded_globals["bridge"], "reps": 12, "rpe": 5})
    c.put(f"/sessions/{sess['id']}", headers=_h(tok),
          json={"ended_at": "2026-04-10T08:00:00Z", "rpe": 5})

    sugs = c.get(f"/routines/{r['id']}/suggestions", headers=_h(tok)).json()
    bridge = next(s for s in sugs if s["exercise_id"] == seeded_globals["bridge"])
    assert bridge["reps"] == 14
    assert "easy" in bridge["reason"].lower()


def test_suggestions_other_users_cannot_access(client, seeded_globals):
    t1 = client.post("/auth/register", json={"email": "u1@x.com", "password": "pw1234567"}).json()["access_token"]
    r = client.post("/routines", headers=_h(t1), json={
        "name": "Mine", "exercises": [{"exercise_id": seeded_globals["bridge"], "target_sets": 1}],
    }).json()
    t2 = client.post("/auth/register", json={"email": "u2@x.com", "password": "pw1234567"}).json()["access_token"]
    r2 = client.get(f"/routines/{r['id']}/suggestions", headers=_h(t2))
    assert r2.status_code == 404
