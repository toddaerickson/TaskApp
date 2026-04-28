"""Shared fixtures: each test file gets a fresh DB (SQLite by default,
Postgres when DATABASE_URL is set in the environment) and a TestClient.

We set DATABASE_URL *before* importing the app so app.config picks up
the right path. A session-scoped fixture initializes the DB; each test's
`client` fixture wipes + re-inits the schema so test order doesn't matter.
"""
import os
import sys
import tempfile
from pathlib import Path
from typing import Iterator

import pytest

# Make sure the backend root is importable when pytest is invoked from elsewhere.
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# app.config guards against running Postgres with the public dev JWT secret
# AND is imported at module top-level by some test files (test_auth_edge.py).
# Set the env var at import time — before any test module is collected —
# so the guard is satisfied under the CI Postgres matrix. Deterministic
# is fine here; tests only care that it's set, not that it's random.
os.environ.setdefault("JWT_SECRET", "test-secret-" + "x" * 48)
# main.py has the same kind of guard for CORS_ORIGINS in postgres mode —
# satisfy it the same way so the import-time check doesn't break the suite.
os.environ.setdefault("CORS_ORIGINS", "http://localhost:8081")
# main.py emits a warn-loudly error in PG mode when BACKEND_PUBLIC_URL is
# missing, and `/health/detailed` exposes the resulting flag. Set a stable
# value so the diagnostic field reports "configured: True" deterministically
# across the SQLite + Postgres CI matrix.
os.environ.setdefault("BACKEND_PUBLIC_URL", "http://test.local")
# /health/detailed and /admin/snapshot share this bearer-token gate.
# Tests pass the token explicitly when calling those endpoints.
os.environ.setdefault("SNAPSHOT_AUTH_TOKEN", "test-snapshot-token-" + "x" * 32)

# Same story for DATABASE_URL: if the caller (CI) already set it, honor
# that. Otherwise fall back to a temp SQLite file that the _db_url fixture
# will manage teardown for.
if not os.environ.get("DATABASE_URL"):
    _fd, _SQLITE_TEST_PATH = tempfile.mkstemp(suffix=".db", prefix="taskapp-test-")
    os.close(_fd)
    os.environ["DATABASE_URL"] = f"sqlite:///{_SQLITE_TEST_PATH}"
else:
    _SQLITE_TEST_PATH = None


@pytest.fixture(scope="session")
def _db_url() -> Iterator[str]:
    """Yields the DATABASE_URL the suite is running against (set at
    conftest-import time above). Handles teardown of the temp SQLite
    file when we're the ones that created it."""
    yield os.environ["DATABASE_URL"]
    if _SQLITE_TEST_PATH:
        try:
            os.unlink(_SQLITE_TEST_PATH)
        except OSError:
            pass


def _wipe_db(url: str) -> None:
    """Reset the DB to an empty state. Called before every test."""
    if url.startswith("sqlite:///"):
        path = url.replace("sqlite:///", "")
        if os.path.exists(path):
            os.unlink(path)
        return
    # Postgres: drop and recreate the public schema. Fast and total.
    import psycopg2
    conn = psycopg2.connect(url)
    conn.autocommit = True
    try:
        cur = conn.cursor()
        cur.execute("DROP SCHEMA IF EXISTS public CASCADE")
        cur.execute("CREATE SCHEMA public")
    finally:
        conn.close()


def _run_migrations_if_pg(url: str) -> None:
    """PG-mode init_db now verifies schema_migrations exists with at
    least one row applied. The Postgres CI matrix wipes the schema
    before every test, so the conftest needs to run the migration
    runner — same flow the operator triggers via fly.toml's
    release_command on deploy. SQLite is no-op (init_db handles dev)."""
    if not url.startswith("postgresql"):
        return
    from scripts import migrate
    rc = migrate.main([])
    if rc != 0:
        raise RuntimeError(f"migrate.py exited {rc} during test setup")


@pytest.fixture
def client(_db_url):
    """Fresh TestClient per test, with a wiped DB so test order doesn't matter."""
    _wipe_db(_db_url)
    _run_migrations_if_pg(_db_url)
    from app.database import init_db
    init_db()

    # Disable the process-wide slowapi limiter by default so the per-IP
    # 10/min cap on /auth/login doesn't leak across tests. A single test
    # (`test_login_rate_limited`) flips it back on to verify the cap works.
    from app.rate_limit import limiter
    limiter.reset()
    limiter.enabled = False

    from fastapi.testclient import TestClient
    from main import app
    with TestClient(app) as c:
        yield c


@pytest.fixture
def auth_client(client):
    """A client preauthenticated as a fresh user; returns (client, token, user_id)."""
    r = client.post("/auth/register", json={"email": "tester@x.com", "password": "pw12345!"})
    assert r.status_code == 200, r.text
    token = r.json()["access_token"]
    me = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"}).json()
    return client, token, me["id"]


@pytest.fixture
def seeded_globals(client):
    """Insert a couple of global exercises directly via the DB (mimics the
    seed script) so route tests don't depend on it."""
    from app.database import get_db
    with get_db() as conn:
        cur = conn.cursor()
        # Pass is_bodyweight as a bound param so psycopg2 adapts Python
        # True→Postgres BOOLEAN. Literal `1` in the SQL text hits the same
        # "boolean column expects boolean" error as the old route code.
        cur.execute(
            """INSERT INTO exercises (user_id, name, slug, category, primary_muscle,
               equipment, difficulty, is_bodyweight, measurement, instructions, cue)
               VALUES (NULL, ?, ?, 'rehab', 'gastroc', 'wall', 1, ?, 'duration', ?, ?)""",
            ("Wall Ankle Dorsiflexion", "wall_ankle_dorsiflexion", True,
             "Half-kneel; drive knee over toe.", "Heel down."),
        )
        wall_id = cur.lastrowid
        cur.execute(
            """INSERT INTO exercises (user_id, name, slug, category, primary_muscle,
               equipment, difficulty, is_bodyweight, measurement, instructions, cue)
               VALUES (NULL, ?, ?, 'strength', 'glute max', 'none', 2, ?, 'reps', ?, ?)""",
            ("Single-Leg Glute Bridge", "single_leg_glute_bridge", True,
             "Drive through heel.", "Squeeze at top."),
        )
        bridge_id = cur.lastrowid
    return {"wall": wall_id, "bridge": bridge_id}


@pytest.fixture
def tz_pinned(monkeypatch):
    """Reusable TZ + datetime fixture for any reminder-shaped test that
    needs deterministic wall-clock arithmetic. Returns a callable
    `pin(year, month, day, hour, minute, tz_name='UTC')` that:

      1. Sets `TASKAPP_TZ=tz_name` for the duration of the test.
      2. Resets the `_TZ_CACHE` so `_operator_tz()` re-resolves.
      3. Patches `app.reminders.datetime` so `datetime.now(tz)` returns
         the pinned moment (correctly converted into the requested tz).
      4. Yields the pinned tz-aware datetime so the test can compute
         relative expectations.

    Extracted in PR-X4 from the ad-hoc `fixed_now` + manual monkeypatch
    + cache-bust pattern that test_missed_reminders.py was repeating.
    Used by both reminder-route tests and any future TZ-sensitive
    helper test."""
    from datetime import datetime as _dt
    from unittest.mock import patch
    from contextlib import ExitStack
    from zoneinfo import ZoneInfo

    stack = ExitStack()

    def pin(year, month, day, hour, minute, tz_name="UTC"):
        from app import reminders as _rem
        monkeypatch.setenv("TASKAPP_TZ", tz_name)
        # Bust the module-level resolver cache so the new env var wins.
        _rem._TZ_CACHE["name"] = None
        _rem._TZ_CACHE["zone"] = None
        _rem._TZ_CACHE["warned"] = False
        zone = ZoneInfo(tz_name)
        pinned = _dt(year, month, day, hour, minute, 0, 0, tzinfo=zone)

        class _PinnedDatetime(_dt):
            @classmethod
            def now(cls, tz=None):
                return pinned.astimezone(tz) if tz else pinned.replace(tzinfo=None)

        stack.enter_context(patch("app.reminders.datetime", _PinnedDatetime))
        return pinned

    yield pin
    stack.close()
