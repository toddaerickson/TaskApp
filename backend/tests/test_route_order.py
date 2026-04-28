"""FastAPI matches routes in declaration order. The /routines router has
a static `/missed-reminders` endpoint that MUST be declared before the
parameterized `/{routine_id}` endpoint, otherwise FastAPI tries to
parse the literal string `"missed-reminders"` as an int routine_id and
422s — the request never reaches the inbox handler.

This test makes the contract explicit: a future refactor that moves
the parameterized handler above the static one breaks CI here, not in
production at 6am when the operator's banner stops working. PR-X4
architectural cleanup, surfaced by the post-ship audit's silent-killer
review."""

from main import app


def _routine_routes():
    """Return [(path, methods, name), ...] for routes under /routines,
    in registration order."""
    out = []
    for r in app.router.routes:
        path = getattr(r, "path", "")
        if not path.startswith("/routines"):
            continue
        out.append((path, sorted(getattr(r, "methods", set()) or []), getattr(r, "name", "")))
    return out


def test_missed_reminders_registered_before_parameterized_get():
    """The static collection-tail `/routines/missed-reminders` must come
    first; otherwise `routine_id="missed-reminders"` fails int validation
    on `/routines/{routine_id}` and the inbox is unreachable."""
    routes = _routine_routes()
    paths_in_order = [p for p, _m, _n in routes]

    static = "/routines/missed-reminders"
    param = "/routines/{routine_id}"

    assert static in paths_in_order, f"missing route {static}"
    assert param in paths_in_order, f"missing route {param}"
    assert paths_in_order.index(static) < paths_in_order.index(param), (
        f"declaration-order violation: {static} must be registered "
        f"before {param}. Current /routines route order:\n  "
        + "\n  ".join(paths_in_order)
    )


def test_missed_reminders_route_resolves_unauthenticated():
    """Sanity check that the static path actually maps to a handler
    (not the int-validator on the parameterized route). 401 — auth
    dep rejects without a token — proves the route matched. A 422
    here would mean order regression."""
    from fastapi.testclient import TestClient
    c = TestClient(app)
    r = c.get("/routines/missed-reminders")
    assert r.status_code == 401, (
        f"expected 401 (auth required) but got {r.status_code} "
        f"({r.json() if r.headers.get('content-type','').startswith('application/json') else r.text}). "
        "A 422 would indicate FastAPI matched /{routine_id} first."
    )
