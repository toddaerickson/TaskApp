"""Routine-level reminder fields."""


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


def test_create_routine_with_reminder_fields(auth_client):
    c, tok, _ = auth_client
    r = c.post("/routines", headers=_h(tok), json={
        "name": "AM", "reminder_time": "07:00", "reminder_days": "mon,wed,fri",
    })
    assert r.status_code == 200
    body = r.json()
    assert body["reminder_time"] == "07:00"
    assert body["reminder_days"] == "mon,wed,fri"


def test_routine_list_echoes_reminder(auth_client):
    c, tok, _ = auth_client
    c.post("/routines", headers=_h(tok), json={"name": "A", "reminder_time": "06:30"})
    c.post("/routines", headers=_h(tok), json={"name": "B"})
    rs = c.get("/routines", headers=_h(tok)).json()
    by_name = {r["name"]: r for r in rs}
    assert by_name["A"]["reminder_time"] == "06:30"
    assert by_name["B"]["reminder_time"] is None


def test_update_sets_and_clears_reminder(auth_client):
    c, tok, _ = auth_client
    r = c.post("/routines", headers=_h(tok), json={"name": "A"}).json()
    upd = c.put(f"/routines/{r['id']}", headers=_h(tok),
                json={"reminder_time": "07:00", "reminder_days": "daily"}).json()
    assert upd["reminder_time"] == "07:00"
    assert upd["reminder_days"] == "daily"
    # Clearing: set back to null.
    cleared = c.put(f"/routines/{r['id']}", headers=_h(tok),
                    json={"reminder_time": None, "reminder_days": None}).json()
    assert cleared["reminder_time"] is None
    assert cleared["reminder_days"] is None


def test_reminder_roundtrips_through_export_import(auth_client):
    c, tok, _ = auth_client
    c.post("/routines", headers=_h(tok), json={
        "name": "AM", "reminder_time": "07:15", "reminder_days": "mon,tue,wed,thu,fri",
    })
    payload = c.get("/export/workouts", headers=_h(tok)).json()
    r = payload["routines"][0]
    assert r["reminder_time"] == "07:15"
    assert r["reminder_days"] == "mon,tue,wed,thu,fri"

    t2 = c.post("/auth/register", json={"email": "u2@x.com", "password": "pw1234567"}).json()["access_token"]
    c.post("/import/workouts", headers=_h(t2), json={"payload": payload, "mode": "merge"})
    rs = c.get("/routines", headers=_h(t2)).json()
    assert rs[0]["reminder_time"] == "07:15"
    assert rs[0]["reminder_days"] == "mon,tue,wed,thu,fri"
