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
from typing import Optional


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
