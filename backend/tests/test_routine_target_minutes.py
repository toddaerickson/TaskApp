"""Tests for the `routines.target_minutes` column + Pydantic bounds
(1-180). Drives the UI duration pill on the routine card; null = no pill.
Replaced the discarded `goal:'quick'` taxonomy hack so duration is
orthogonal to the goal category.
"""


def _h(token):
    return {"Authorization": f"Bearer {token}"}


def test_create_routine_with_target_minutes(auth_client):
    c, tok, _ = auth_client
    r = c.post("/routines", headers=_h(tok), json={
        "name": "Quick mobility",
        "goal": "mobility",
        "target_minutes": 5,
    })
    assert r.status_code == 200
    assert r.json()["target_minutes"] == 5


def test_target_minutes_round_trips_through_get(auth_client):
    c, tok, _ = auth_client
    rid = c.post("/routines", headers=_h(tok), json={
        "name": "AM snack",
        "target_minutes": 8,
    }).json()["id"]
    fetched = c.get(f"/routines/{rid}", headers=_h(tok)).json()
    assert fetched["target_minutes"] == 8


def test_create_routine_without_target_minutes_defaults_to_null(auth_client):
    """Pre-feature routines + new routines that omit the field both read
    as null. Mobile hides the pill in that case."""
    c, tok, _ = auth_client
    r = c.post("/routines", headers=_h(tok), json={"name": "No duration"})
    assert r.status_code == 200
    assert r.json()["target_minutes"] is None


def test_update_routine_target_minutes(auth_client):
    c, tok, _ = auth_client
    rid = c.post("/routines", headers=_h(tok), json={"name": "x"}).json()["id"]
    r = c.put(f"/routines/{rid}", headers=_h(tok), json={"target_minutes": 12})
    assert r.status_code == 200
    assert r.json()["target_minutes"] == 12


def test_target_minutes_zero_rejected(auth_client):
    c, tok, _ = auth_client
    r = c.post("/routines", headers=_h(tok), json={
        "name": "x", "target_minutes": 0,
    })
    assert r.status_code == 422


def test_target_minutes_above_180_rejected(auth_client):
    """180 min upper bound matches the longest realistic single routine
    (a comprehensive 3-hour mobility/strength session). Higher values
    almost certainly indicate a unit mistake (seconds vs minutes)."""
    c, tok, _ = auth_client
    r = c.post("/routines", headers=_h(tok), json={
        "name": "x", "target_minutes": 200,
    })
    assert r.status_code == 422


def test_target_minutes_negative_rejected(auth_client):
    c, tok, _ = auth_client
    r = c.post("/routines", headers=_h(tok), json={
        "name": "x", "target_minutes": -5,
    })
    assert r.status_code == 422


def test_clone_routine_copies_target_minutes(auth_client):
    """Cloning a routine should preserve its duration estimate — same
    template, same time budget."""
    c, tok, _ = auth_client
    src = c.post("/routines", headers=_h(tok), json={
        "name": "Source", "target_minutes": 7,
    }).json()
    cloned = c.post(f"/routines/{src['id']}/clone", headers=_h(tok)).json()
    assert cloned["target_minutes"] == 7
