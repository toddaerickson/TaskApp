"""Tests for the image endpoints:
- POST /exercises/{id}/images (single add)
- DELETE /exercises/images/{id}
- POST /exercises/images/bulk (multi-slug paste)
- GET /exercises/{id}/search-images (with providers monkeypatched to
  avoid hitting the live DDG/Pixabay services in tests).
"""
import pytest


def _h(token):
    return {"Authorization": f"Bearer {token}"}


# ---------- Single image add / delete ----------

def test_add_and_list_image(auth_client, seeded_globals):
    c, tok, _ = auth_client
    r = c.post(f"/exercises/{seeded_globals['wall']}/images", headers=_h(tok),
               json={"url": "https://example.com/a.jpg", "caption": "start"})
    assert r.status_code == 200
    fetched = c.get(f"/exercises/{seeded_globals['wall']}", headers=_h(tok)).json()
    assert len(fetched["images"]) == 1
    assert fetched["images"][0]["url"] == "https://example.com/a.jpg"


def test_delete_image(auth_client, seeded_globals):
    c, tok, _ = auth_client
    img = c.post(f"/exercises/{seeded_globals['wall']}/images", headers=_h(tok),
                 json={"url": "https://example.com/a.jpg"}).json()
    r = c.delete(f"/exercises/images/{img['id']}", headers=_h(tok))
    assert r.status_code == 200
    fetched = c.get(f"/exercises/{seeded_globals['wall']}", headers=_h(tok)).json()
    assert fetched["images"] == []


# ---------- Bulk image assignment ----------

def test_bulk_images_appends_to_existing(auth_client, seeded_globals):
    c, tok, _ = auth_client
    c.post(f"/exercises/{seeded_globals['wall']}/images", headers=_h(tok),
           json={"url": "https://example.com/existing.jpg"})
    r = c.post("/exercises/images/bulk", headers=_h(tok), json={"entries": [
        {"slug": "wall_ankle_dorsiflexion", "urls": [
            "https://example.com/new1.jpg",
            "https://example.com/new2.jpg",
        ]},
    ]})
    assert r.status_code == 200
    body = r.json()
    assert body == [{"slug": "wall_ankle_dorsiflexion", "status": "ok", "added": 2, "replaced": 0}]
    fetched = c.get(f"/exercises/{seeded_globals['wall']}", headers=_h(tok)).json()
    urls = [i["url"] for i in fetched["images"]]
    assert "https://example.com/existing.jpg" in urls
    assert "https://example.com/new1.jpg" in urls


def test_bulk_images_replace_mode_wipes_existing(auth_client, seeded_globals):
    c, tok, _ = auth_client
    c.post(f"/exercises/{seeded_globals['wall']}/images", headers=_h(tok),
           json={"url": "https://example.com/old.jpg"})
    r = c.post("/exercises/images/bulk", headers=_h(tok), json={"entries": [
        {"slug": "wall_ankle_dorsiflexion", "urls": ["https://example.com/fresh.jpg"], "replace": True},
    ]})
    assert r.json()[0]["replaced"] == 1
    urls = [i["url"] for i in c.get(f"/exercises/{seeded_globals['wall']}", headers=_h(tok)).json()["images"]]
    assert urls == ["https://example.com/fresh.jpg"]


def test_bulk_images_unknown_slug_reports_not_found(auth_client):
    c, tok, _ = auth_client
    r = c.post("/exercises/images/bulk", headers=_h(tok), json={"entries": [
        {"slug": "does_not_exist", "urls": ["https://example.com/x.jpg"]},
    ]})
    assert r.json() == [{"slug": "does_not_exist", "status": "not_found", "added": 0, "replaced": 0}]


# ---------- search-images (with monkeypatched providers) ----------

@pytest.fixture
def mock_search_providers(monkeypatch):
    """Replace DDG + Pixabay search with in-memory fakes so we never hit
    the network in tests."""
    from app.routes import exercise_routes

    def fake_ddg(query, n):
        return [
            exercise_routes.ImageCandidate(
                url=f"https://ddg/{query.replace(' ', '_')}/{i}.jpg",
                thumb=f"https://ddg-thumb/{i}.jpg",
                source="ddg",
                width=200, height=200,
            )
            for i in range(min(n, 3))
        ]

    def fake_pix(query, n):
        return [
            exercise_routes.ImageCandidate(
                url=f"https://pix/{query.replace(' ', '_')}/{i}.jpg",
                thumb=f"https://pix-thumb/{i}.jpg",
                source="pixabay.com",
                width=300, height=300,
            )
            for i in range(min(n, 2))
        ]

    monkeypatch.setattr(exercise_routes, "_search_ddg", fake_ddg)
    monkeypatch.setattr(exercise_routes, "_search_pixabay", fake_pix)
    # Also clear the in-process TTL cache between tests.
    exercise_routes._SEARCH_CACHE.clear()


def test_search_images_returns_interleaved_results(auth_client, seeded_globals, mock_search_providers):
    c, tok, _ = auth_client
    r = c.get(f"/exercises/{seeded_globals['wall']}/search-images?n=5", headers=_h(tok))
    assert r.status_code == 200
    results = r.json()
    # Pixabay contributed 2, DDG 3 → 5 unique, interleaved pixabay-first.
    assert len(results) == 5
    sources = [r["source"] for r in results]
    assert sources.count("pixabay.com") == 2
    assert sources.count("ddg") == 3


def test_search_images_uses_override_query(auth_client, seeded_globals, mock_search_providers):
    c, tok, _ = auth_client
    r = c.get(f"/exercises/{seeded_globals['wall']}/search-images",
              params={"q": "custom query", "n": 3}, headers=_h(tok))
    assert r.status_code == 200
    urls = [x["url"] for x in r.json()]
    assert any("custom_query" in u for u in urls)


def test_search_images_caches_repeat_calls(auth_client, seeded_globals, monkeypatch):
    """Second identical call should hit the in-process TTL cache."""
    from app.routes import exercise_routes
    calls = {"ddg": 0, "pix": 0}

    def counting_ddg(q, n):
        calls["ddg"] += 1
        return [exercise_routes.ImageCandidate(url="https://ddg/x.jpg", source="ddg")]

    def counting_pix(q, n):
        calls["pix"] += 1
        return []

    monkeypatch.setattr(exercise_routes, "_search_ddg", counting_ddg)
    monkeypatch.setattr(exercise_routes, "_search_pixabay", counting_pix)
    exercise_routes._SEARCH_CACHE.clear()

    c, tok, _ = auth_client
    url = f"/exercises/{seeded_globals['wall']}/search-images?n=5"
    c.get(url, headers=_h(tok))
    c.get(url, headers=_h(tok))
    c.get(url, headers=_h(tok))
    # Cached on second + third calls.
    assert calls["ddg"] == 1, f"expected 1 DDG call, got {calls['ddg']}"


def test_search_images_404_on_bogus_exercise(auth_client, mock_search_providers):
    c, tok, _ = auth_client
    r = c.get("/exercises/99999/search-images", headers=_h(tok))
    assert r.status_code == 404
