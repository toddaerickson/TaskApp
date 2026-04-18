"""Contract tests between the FastAPI OpenAPI spec and what mobile/lib/api.ts
expects. Cheap drift detector: when a backend route/schema changes in a way
that breaks the mobile client, this fails before the field actually lands
in production.

Not a full type-sync (that'd need `openapi-typescript` in CI); this pins
the critical-path endpoints + response shapes that mobile depends on
today. If you rename a field here, bump the mobile client in the same PR.
"""
import pytest


@pytest.fixture
def spec(client):
    r = client.get("/openapi.json")
    assert r.status_code == 200
    return r.json()


# --- critical endpoints must remain routable ------------------------------

CRITICAL_PATHS = [
    ("/auth/register", "post"),
    ("/auth/login", "post"),
    ("/auth/me", "get"),
    ("/tasks", "get"),
    ("/tasks", "post"),
    ("/tasks/{task_id}", "put"),
    ("/folders", "get"),
    ("/routines", "get"),
    ("/routines/{routine_id}", "get"),
    ("/routines/{routine_id}/suggestions", "get"),
    ("/sessions", "post"),
    ("/sessions/{session_id}", "get"),
    ("/sessions/{session_id}/prs", "get"),
    ("/sessions/{session_id}/sets", "post"),
]


@pytest.mark.parametrize("path,method", CRITICAL_PATHS)
def test_critical_endpoint_is_exposed(spec, path, method):
    paths = spec.get("paths", {})
    assert path in paths, f"OpenAPI spec is missing {path}"
    assert method in paths[path], f"{method.upper()} {path} is no longer routed"


# --- key response schemas keep their required fields ---------------------

def _schema(spec, name: str) -> dict:
    schemas = spec.get("components", {}).get("schemas", {})
    assert name in schemas, f"OpenAPI spec is missing schema {name!r}"
    return schemas[name]


def _prop_keys(schema: dict) -> set[str]:
    """Return the top-level property names, handling allOf / anyOf / $ref
    compositions FastAPI may emit when a model extends another."""
    if "properties" in schema:
        return set(schema["properties"].keys())
    collected: set[str] = set()
    for key in ("allOf", "anyOf", "oneOf"):
        for part in schema.get(key, []):
            if isinstance(part, dict):
                collected |= _prop_keys(part)
    return collected


def test_task_response_has_mobile_consumed_fields(spec):
    fields = _prop_keys(_schema(spec, "TaskResponse"))
    # These are what mobile/lib/stores.ts + screens rely on; breaking one
    # should be deliberate, not an accidental rename.
    required = {
        "id", "title", "folder_id", "folder_name", "priority", "status",
        "starred", "due_date", "completed", "tags",
    }
    missing = required - fields
    assert not missing, f"TaskResponse is missing mobile-consumed fields: {missing}"


def test_session_response_has_sets(spec):
    fields = _prop_keys(_schema(spec, "SessionResponse"))
    for f in ("id", "user_id", "routine_id", "started_at", "ended_at", "sets"):
        assert f in fields, f"SessionResponse missing field {f!r}"


def test_exercise_best_matches_client_shape(spec):
    fields = _prop_keys(_schema(spec, "ExerciseBest"))
    assert fields >= {"exercise_id", "max_weight", "max_reps", "max_duration_sec"}


def test_token_response_has_access_token(spec):
    fields = _prop_keys(_schema(spec, "TokenResponse"))
    assert "access_token" in fields
