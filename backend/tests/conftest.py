"""Shared fixtures: each test file gets a fresh SQLite DB and a TestClient.

We override DATABASE_URL *before* importing the app so app.config picks up
the temp path, then call init_db() to create the schema. The DB file is
removed after the session.
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


@pytest.fixture(scope="session")
def _tmp_db_path() -> Iterator[str]:
    fd, path = tempfile.mkstemp(suffix=".db", prefix="taskapp-test-")
    os.close(fd)
    os.environ["DATABASE_URL"] = f"sqlite:///{path}"
    # Force a re-import of any cached modules that captured DATABASE_URL.
    for mod in list(sys.modules):
        if mod.startswith("app.") or mod == "app" or mod == "main":
            del sys.modules[mod]
    yield path
    try:
        os.unlink(path)
    except OSError:
        pass


@pytest.fixture
def client(_tmp_db_path):
    """Fresh TestClient per test, with a wiped DB so test order doesn't matter."""
    # Wipe + re-init the schema before each test.
    from app.database import init_db
    if os.path.exists(_tmp_db_path):
        os.unlink(_tmp_db_path)
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
        cur.execute(
            """INSERT INTO exercises (user_id, name, slug, category, primary_muscle,
               equipment, difficulty, is_bodyweight, measurement, instructions, cue)
               VALUES (NULL, ?, ?, 'rehab', 'gastroc', 'wall', 1, 1, 'duration', ?, ?)""",
            ("Wall Ankle Dorsiflexion", "wall_ankle_dorsiflexion",
             "Half-kneel; drive knee over toe.", "Heel down."),
        )
        wall_id = cur.lastrowid
        cur.execute(
            """INSERT INTO exercises (user_id, name, slug, category, primary_muscle,
               equipment, difficulty, is_bodyweight, measurement, instructions, cue)
               VALUES (NULL, ?, ?, 'strength', 'glute max', 'none', 2, 1, 'reps', ?, ?)""",
            ("Single-Leg Glute Bridge", "single_leg_glute_bridge",
             "Drive through heel.", "Squeeze at top."),
        )
        bridge_id = cur.lastrowid
    return {"wall": wall_id, "bridge": bridge_id}
