"""Cursor pagination on /routines and /sessions. Client passes `cursor` =
id of the last item on the previous page; server returns the next page."""


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


def _seed_routines(client, token, n: int) -> list[int]:
    ids: list[int] = []
    for i in range(n):
        r = client.post(
            "/routines",
            json={"name": f"routine-{i}", "goal": "mobility"},
            headers=_h(token),
        )
        assert r.status_code == 200, r.text
        ids.append(r.json()["id"])
    return ids


def _seed_sessions(client, token, n: int) -> list[int]:
    ids: list[int] = []
    for _ in range(n):
        r = client.post("/sessions", json={}, headers=_h(token))
        assert r.status_code == 200, r.text
        ids.append(r.json()["id"])
    return ids


# ---------- /routines pagination ----------

def test_routines_default_pagination_returns_at_most_50(auth_client):
    client, token, _ = auth_client
    _seed_routines(client, token, 60)
    r = client.get("/routines", headers=_h(token))
    assert r.status_code == 200
    assert len(r.json()) == 50


def test_routines_cursor_returns_next_page(auth_client):
    client, token, _ = auth_client
    ids = _seed_routines(client, token, 5)

    first = client.get("/routines?limit=2", headers=_h(token)).json()
    assert [r["id"] for r in first] == ids[:2]

    cursor = first[-1]["id"]
    second = client.get(f"/routines?limit=2&cursor={cursor}", headers=_h(token)).json()
    assert [r["id"] for r in second] == ids[2:4]


def test_routines_limit_max_clamped(auth_client):
    client, token, _ = auth_client
    _seed_routines(client, token, 2)
    # Beyond-max values should 422 via Query(le=200).
    r = client.get("/routines?limit=500", headers=_h(token))
    assert r.status_code == 422


# ---------- /sessions pagination ----------

def test_sessions_newest_first_default(auth_client):
    client, token, _ = auth_client
    ids = _seed_sessions(client, token, 3)
    r = client.get("/sessions?limit=10", headers=_h(token))
    assert r.status_code == 200
    returned = [s["id"] for s in r.json()]
    # Inserted 1,2,3 → expect descending [3,2,1].
    assert returned == list(reversed(ids))


def test_sessions_cursor_paginates_backwards_in_time(auth_client):
    client, token, _ = auth_client
    ids = _seed_sessions(client, token, 5)
    # ids are [1..5] (roughly); newest-first is [5,4,3,2,1].
    first = client.get("/sessions?limit=2", headers=_h(token)).json()
    assert [s["id"] for s in first] == [ids[-1], ids[-2]]

    cursor = first[-1]["id"]  # id of the last (older) item on page 1
    second = client.get(f"/sessions?limit=2&cursor={cursor}", headers=_h(token)).json()
    # Expect the next two older ids.
    assert [s["id"] for s in second] == [ids[-3], ids[-4]]


def test_sessions_cursor_past_last_returns_empty(auth_client):
    client, token, _ = auth_client
    ids = _seed_sessions(client, token, 2)
    oldest = ids[0]
    r = client.get(f"/sessions?cursor={oldest}", headers=_h(token)).json()
    assert r == []


def test_sessions_pagination_respects_routine_id(auth_client):
    """The routine_id filter still applies alongside cursor."""
    client, token, _ = auth_client
    # Create a routine, start 3 sessions under it + 2 freestyle.
    routine_id = client.post(
        "/routines",
        json={"name": "filter-me", "goal": "strength"},
        headers=_h(token),
    ).json()["id"]

    tied: list[int] = []
    for _ in range(3):
        r = client.post("/sessions", json={"routine_id": routine_id}, headers=_h(token))
        tied.append(r.json()["id"])

    # Plus a couple that shouldn't appear.
    client.post("/sessions", json={}, headers=_h(token))
    client.post("/sessions", json={}, headers=_h(token))

    r = client.get(f"/sessions?routine_id={routine_id}", headers=_h(token)).json()
    assert [s["id"] for s in r] == list(reversed(tied))
    assert all(s["routine_id"] == routine_id for s in r)
