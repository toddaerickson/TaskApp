"""Request-ID middleware tests: every response carries X-Request-Id,
client-supplied ids are honored, and error bodies include the id so a
mobile crash report can be paired with a server log line."""


def test_response_carries_request_id_header(client):
    r = client.get("/health")
    assert r.status_code == 200
    rid = r.headers.get("X-Request-Id")
    assert rid and len(rid) >= 8


def test_client_supplied_request_id_is_echoed(client):
    custom = "mobile-abc-123"
    r = client.get("/health", headers={"X-Request-Id": custom})
    assert r.status_code == 200
    assert r.headers.get("X-Request-Id") == custom


def test_overlong_client_id_is_discarded_in_favor_of_a_fresh_one(client):
    long_id = "x" * 500
    r = client.get("/health", headers={"X-Request-Id": long_id})
    assert r.status_code == 200
    rid = r.headers.get("X-Request-Id")
    assert rid and rid != long_id and len(rid) <= 64


def test_error_body_includes_request_id(client):
    # Trigger a validation error; its JSON body should carry the same id
    # that the response header exposes.
    r = client.post("/auth/register", json={"email": "not-an-email", "password": "pw12345!"})
    assert r.status_code == 422
    header_id = r.headers.get("X-Request-Id")
    body_id = r.json().get("request_id")
    assert header_id and body_id == header_id


def test_successful_requests_do_not_leak_request_id_in_body(client):
    """The request_id field is an error-surface affordance, not a global
    envelope — happy-path responses should keep their original shape so
    existing clients don't break."""
    r = client.get("/health")
    assert r.json() == {"status": "ok"}
