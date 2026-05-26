"""Shared optimistic-concurrency helpers for PUT routes.

Both `routine_routes.py` and `task_routes.py` accept an
`expected_updated_at` snapshot from the client; if the row has moved
past that snapshot, the server returns 409 with the current row
embedded so the client can reconcile in one round-trip.

The routine route shipped this pattern first (see PR around 2026-04
for routines). The drag-to-regroup feature for tasks needs the same
guard — without it, concurrent PUTs on the same row silently
last-write-wins, and a drag rollback on PUT-A failure can stomp the
optimistic state from in-flight PUT-B.

Helpers live here (not in either route file) so the implementation
is canonical and a future PUT route doesn't fork its own coercion.
"""

from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import HTTPException
from fastapi.encoders import jsonable_encoder


def utc_now_text() -> str:
    """Canonical server-side timestamp for TEXT/TIMESTAMPTZ columns.

    Produces `'YYYY-MM-DD HH:MM:SS'` — naive UTC, space separator,
    second granularity. Matches SQLite's `datetime('now')` default so
    any future TEXT lex compare on the SQLite leg behaves correctly
    (the PR #190 / S4 / S7 trap class). PG stores it as TIMESTAMPTZ
    either way; this is the producer-side guard.

    Use this anywhere a route writes `updated_at` / `completed_at` /
    `ended_at` from a server-generated `now`. Don't reinvent the
    pattern — inline `datetime.now(timezone.utc).isoformat(sep=' ',
    timespec='seconds')` still leaks a `+00:00` tail because the
    datetime is tz-aware.
    """
    return datetime.now(timezone.utc).replace(tzinfo=None).isoformat(sep=" ", timespec="seconds")


def parse_ts(v) -> Optional[datetime]:
    """Coerce a DB timestamp (SQLite TEXT or PG datetime) into a
    timezone-aware datetime for comparison.

    SQLite stores 'YYYY-MM-DD HH:MM:SS' UTC; Postgres returns a
    proper datetime already. NULL (legacy rows without updated_at)
    becomes None and opts the row out of the conflict check.
    """
    if v is None:
        return None
    if isinstance(v, datetime):
        return v if v.tzinfo else v.replace(tzinfo=timezone.utc)
    if isinstance(v, str):
        s = v.replace("T", " ").rstrip("Z")
        try:
            dt = datetime.fromisoformat(s)
        except ValueError:
            return None
        return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt
    return None


def is_conflict(current: Optional[datetime], expected: Optional[datetime]) -> bool:
    """True iff the row has moved past the client's snapshot.

    NULL `current` (legacy row without updated_at) opts out.
    NULL `expected` (client didn't send one) also opts out — this is
    an opt-in check so existing callers aren't broken.

    Compare at second granularity because SQLite's `datetime('now')`
    truncates to seconds; a round-trip through Pydantic that
    preserves microseconds would otherwise trip a false positive.
    """
    if expected is None or current is None:
        return False
    return current.replace(microsecond=0) > expected.replace(microsecond=0)


def raise_conflict(current: Any, label: str) -> None:
    """Raise the canonical 409 conflict shape that PUT routes return
    when the row has moved past the client's snapshot. The client gets
    the current server-side row embedded so it can reconcile in a
    single round-trip (used by mobile's `askConflict` prompt).

    `current` is the hydrated row (any JSON-serializable shape);
    `label` is the human-readable noun for the prompt ("routine",
    "task", "exercise", "session"). Three PUT routes inlined this
    pattern before PR-Y3 consolidated it here."""
    raise HTTPException(
        status_code=409,
        detail={
            "code": "conflict",
            "detail": f"{label.capitalize()} changed since you loaded it.",
            "current": jsonable_encoder(current),
        },
    )
