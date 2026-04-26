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


# ---------- Dedup by content_hash ----------

def test_add_image_dedup_returns_existing(auth_client, seeded_globals):
    """Same URL twice → the second POST returns the first row's id, no
    duplicate in the DB. Idempotent for bulk scripts and admin repeats."""
    c, tok, _ = auth_client
    url = "https://example.com/dedup.jpg"
    r1 = c.post(f"/exercises/{seeded_globals['wall']}/images", headers=_h(tok),
                json={"url": url})
    r2 = c.post(f"/exercises/{seeded_globals['wall']}/images", headers=_h(tok),
                json={"url": url})
    assert r1.status_code == 200 and r2.status_code == 200
    assert r1.json()["id"] == r2.json()["id"]
    fetched = c.get(f"/exercises/{seeded_globals['wall']}", headers=_h(tok)).json()
    assert len(fetched["images"]) == 1


def test_add_image_dedup_normalizes_scheme_and_host_case(auth_client, seeded_globals):
    """Same image fetched over different scheme/host casings should dedup —
    that's the whole point of normalizing before hashing."""
    c, tok, _ = auth_client
    a = "HTTPS://Example.COM/Image.Jpg?v=1"
    b = "https://example.com/Image.Jpg?v=1"
    r1 = c.post(f"/exercises/{seeded_globals['wall']}/images", headers=_h(tok), json={"url": a})
    r2 = c.post(f"/exercises/{seeded_globals['wall']}/images", headers=_h(tok), json={"url": b})
    assert r1.json()["id"] == r2.json()["id"]


def test_add_image_dedup_ignores_url_fragment(auth_client, seeded_globals):
    """#fragment is client-side only; same resource either way."""
    c, tok, _ = auth_client
    a = "https://example.com/img.jpg"
    b = "https://example.com/img.jpg#top"
    r1 = c.post(f"/exercises/{seeded_globals['wall']}/images", headers=_h(tok), json={"url": a})
    r2 = c.post(f"/exercises/{seeded_globals['wall']}/images", headers=_h(tok), json={"url": b})
    assert r1.json()["id"] == r2.json()["id"]


def test_add_image_dedup_different_exercises_allow_same_url(auth_client, seeded_globals):
    """Dedup is scoped per-exercise — two exercises can share a URL."""
    c, tok, _ = auth_client
    url = "https://example.com/shared.jpg"
    r1 = c.post(f"/exercises/{seeded_globals['wall']}/images", headers=_h(tok), json={"url": url})
    r2 = c.post(f"/exercises/{seeded_globals['bridge']}/images", headers=_h(tok), json={"url": url})
    assert r1.status_code == 200 and r2.status_code == 200
    assert r1.json()["id"] != r2.json()["id"]


def test_bulk_images_dedups_within_batch(auth_client, seeded_globals):
    c, tok, _ = auth_client
    r = c.post("/exercises/images/bulk", headers=_h(tok), json={"entries": [
        {"slug": "wall_ankle_dorsiflexion", "urls": [
            "https://example.com/x.jpg",
            "https://example.com/x.jpg",   # exact dupe
            "HTTPS://Example.COM/x.jpg",   # normalized dupe
        ]},
    ]})
    assert r.status_code == 200
    assert r.json()[0]["added"] == 1


def test_bulk_images_dedups_against_existing(auth_client, seeded_globals):
    c, tok, _ = auth_client
    c.post(f"/exercises/{seeded_globals['wall']}/images", headers=_h(tok),
           json={"url": "https://example.com/already.jpg"})
    r = c.post("/exercises/images/bulk", headers=_h(tok), json={"entries": [
        {"slug": "wall_ankle_dorsiflexion", "urls": [
            "https://example.com/already.jpg",    # dedup against existing
            "https://example.com/new.jpg",        # fresh
        ]},
    ]})
    assert r.json()[0]["added"] == 1
    fetched = c.get(f"/exercises/{seeded_globals['wall']}", headers=_h(tok)).json()
    assert len(fetched["images"]) == 2


# ---------- search-images (with monkeypatched providers) ----------

@pytest.fixture
def mock_search_providers(monkeypatch):
    """Replace every image provider with in-memory fakes so we never hit
    the network in tests. Also clears the TTL + negative caches so tests
    don't contaminate each other."""
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

    def fake_wm(query, n):
        return [
            exercise_routes.ImageCandidate(
                url=f"https://wm/{query.replace(' ', '_')}/{i}.jpg",
                thumb=f"https://wm-thumb/{i}.jpg",
                source="commons.wikimedia.org",
                width=400, height=400,
            )
            for i in range(min(n, 2))
        ]

    monkeypatch.setattr(exercise_routes, "_search_ddg", fake_ddg)
    monkeypatch.setattr(exercise_routes, "_search_pixabay", fake_pix)
    monkeypatch.setattr(exercise_routes, "_search_wikimedia", fake_wm)
    exercise_routes._SEARCH_CACHE.clear()
    exercise_routes._NEG_CACHE.clear()


def test_search_images_returns_interleaved_results(auth_client, seeded_globals, mock_search_providers):
    c, tok, _ = auth_client
    r = c.get(f"/exercises/{seeded_globals['wall']}/search-images?n=5", headers=_h(tok))
    assert r.status_code == 200
    results = r.json()
    # Three providers round-robin (pixabay→ddg→wikimedia), capped at 5.
    # Counts per provider don't match their raw returns because of the cap
    # and round-robin: [pix0, ddg0, wm0, pix1, ddg1].
    assert len(results) == 5
    sources = [r["source"] for r in results]
    assert sources.count("pixabay.com") == 2
    assert sources.count("ddg") == 2
    assert sources.count("commons.wikimedia.org") == 1


def test_search_images_skips_failing_provider_next_call(auth_client, seeded_globals, monkeypatch):
    """If a provider raises once, the negative cache skips it for ~60s."""
    from app.routes import exercise_routes
    calls = {"pix": 0, "ddg": 0, "wm": 0}

    def counting_pix(q, n):
        calls["pix"] += 1
        raise RuntimeError("pixabay is down")

    def counting_ddg(q, n):
        calls["ddg"] += 1
        return [exercise_routes.ImageCandidate(url="https://ddg/ok.jpg", source="ddg")]

    def counting_wm(q, n):
        calls["wm"] += 1
        return [exercise_routes.ImageCandidate(url="https://wm/ok.jpg", source="commons.wikimedia.org")]

    monkeypatch.setattr(exercise_routes, "_search_pixabay", counting_pix)
    monkeypatch.setattr(exercise_routes, "_search_ddg", counting_ddg)
    monkeypatch.setattr(exercise_routes, "_search_wikimedia", counting_wm)
    exercise_routes._SEARCH_CACHE.clear()
    exercise_routes._NEG_CACHE.clear()

    c, tok, _ = auth_client
    # First call fans out to all three; pixabay raises and gets marked.
    c.get(f"/exercises/{seeded_globals['wall']}/search-images?q=quad%20stretch&n=4", headers=_h(tok))
    # Second call with a DIFFERENT query so the positive cache doesn't serve —
    # negative cache is keyed per (provider, query, n), so pixabay gets
    # called again for a different query. That's the intended behavior.
    c.get(f"/exercises/{seeded_globals['wall']}/search-images?q=other&n=4", headers=_h(tok))
    # Same query as the first — negative cache kicks in; pix NOT called.
    c.get(f"/exercises/{seeded_globals['wall']}/search-images?q=quad%20stretch&n=4", headers=_h(tok))

    assert calls["pix"] == 2, f"expected pixabay called twice (once per distinct query), got {calls['pix']}"
    assert calls["ddg"] == 2  # same positive-cache story: two distinct queries
    assert calls["wm"] == 2


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


# ---------- alt_text (a11y) ----------

def test_add_image_omitted_alt_returns_default(auth_client, seeded_globals):
    """No alt_text in the request → response substitutes
    "{exercise.name} demonstration" so VoiceOver always has something."""
    c, tok, _ = auth_client
    r = c.post(f"/exercises/{seeded_globals['wall']}/images", headers=_h(tok),
               json={"url": "https://example.com/a.jpg"})
    assert r.status_code == 200
    assert r.json()["alt_text"] == "Wall Ankle Dorsiflexion demonstration"


def test_add_image_explicit_alt_round_trips(auth_client, seeded_globals):
    """Caller-supplied alt_text wins over the default and survives the
    INSERT → SELECT round trip."""
    c, tok, _ = auth_client
    r = c.post(
        f"/exercises/{seeded_globals['wall']}/images",
        headers=_h(tok),
        json={"url": "https://example.com/a.jpg", "alt_text": "Half-kneeling lunge over toes"},
    )
    assert r.status_code == 200
    assert r.json()["alt_text"] == "Half-kneeling lunge over toes"


def test_legacy_null_alt_text_substituted_at_get(auth_client, seeded_globals):
    """Rows that predate the alt_text column have NULL stored. The hydrator
    has to fill in the default at read time so older clients (and old
    seed data) still announce something through VoiceOver."""
    from app.database import get_db
    c, tok, _ = auth_client
    # Bypass the route — insert directly so alt_text genuinely lands as NULL.
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO exercise_images (exercise_id, url, sort_order, alt_text) "
            "VALUES (?, ?, ?, NULL)",
            (seeded_globals["wall"], "https://example.com/legacy.jpg", 0),
        )
    fetched = c.get(f"/exercises/{seeded_globals['wall']}", headers=_h(tok)).json()
    assert len(fetched["images"]) == 1
    assert fetched["images"][0]["alt_text"] == "Wall Ankle Dorsiflexion demonstration"


def test_routine_get_hydrates_alt_text_on_nested_exercise_images(auth_client, seeded_globals):
    """Routine GET reuses the same hydrator path. Images attached to an
    exercise referenced by a routine should pick up the alt_text default
    too — otherwise the workout-screen list would re-introduce the gap."""
    c, tok, _ = auth_client
    c.post(f"/exercises/{seeded_globals['wall']}/images", headers=_h(tok),
           json={"url": "https://example.com/r.jpg"})
    routine = c.post(
        "/routines",
        headers=_h(tok),
        json={"name": "Mobility AM", "exercises": [{"exercise_id": seeded_globals["wall"]}]},
    ).json()
    fetched = c.get(f"/routines/{routine['id']}", headers=_h(tok)).json()
    images = fetched["exercises"][0]["exercise"]["images"]
    assert images[0]["alt_text"] == "Wall Ankle Dorsiflexion demonstration"
