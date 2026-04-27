"""Every /admin/* request writes one row to admin_audit, regardless of
the response status. Non-admin paths never do.

Uses pytest's `monkeypatch` for env mutation so test ordering doesn't
matter — earlier draft poked `os.environ.pop(...)` directly and leaked
state to anyone running after, breaking tests that depend on the
conftest-supplied `SNAPSHOT_AUTH_TOKEN`."""

from app.database import get_db


def _rows():
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT method, path, status_code, request_id, client_ip, user_agent "
            "FROM admin_audit ORDER BY id ASC"
        )
        return [dict(r) for r in cur.fetchall()]


def test_admin_hit_writes_an_audit_row_even_when_not_configured(client, monkeypatch):
    # SNAPSHOT_AUTH_TOKEN unset → the route responds 503, but the
    # request is still audited so ops can see that someone tried to
    # hit the endpoint.
    monkeypatch.delenv("SNAPSHOT_AUTH_TOKEN", raising=False)
    r = client.get("/admin/snapshot", headers={"User-Agent": "test-agent"})
    assert r.status_code == 503

    rows = _rows()
    assert len(rows) == 1
    assert rows[0]["method"] == "GET"
    assert rows[0]["path"] == "/admin/snapshot"
    assert rows[0]["status_code"] == 503
    assert rows[0]["user_agent"] == "test-agent"
    # request_id is set — pairs with the `rid=…` server log line.
    assert rows[0]["request_id"]


def test_admin_hit_with_valid_token_writes_200_row(client, monkeypatch):
    monkeypatch.setenv("SNAPSHOT_AUTH_TOKEN", "s3cret")
    r = client.get("/admin/snapshot", headers={"Authorization": "Bearer s3cret"})
    assert r.status_code == 200
    rows = _rows()
    assert len(rows) == 1
    assert rows[0]["status_code"] == 200
    assert rows[0]["path"] == "/admin/snapshot"


def test_admin_hit_with_bad_token_still_audits(client, monkeypatch):
    monkeypatch.setenv("SNAPSHOT_AUTH_TOKEN", "s3cret")
    r = client.get("/admin/snapshot", headers={"Authorization": "Bearer wrong"})
    assert r.status_code == 401
    rows = _rows()
    assert len(rows) == 1
    assert rows[0]["status_code"] == 401


def test_non_admin_paths_do_not_write_audit_rows(auth_client):
    client, _, _ = auth_client
    # /auth/register already ran via the auth_client fixture.
    assert _rows() == []

    client.get("/tasks", headers={"Authorization": f"Bearer {auth_client[1]}"})
    client.get("/folders", headers={"Authorization": f"Bearer {auth_client[1]}"})
    # Still empty — none of these are /admin/*.
    assert _rows() == []
