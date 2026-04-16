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


@pytest.fixture
def client(_db_url):
    """Fresh TestClient per test, with a wiped DB so test order doesn't matter."""
    _wipe_db(_db_url)
    from app.database import init_db
    init_db()

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
